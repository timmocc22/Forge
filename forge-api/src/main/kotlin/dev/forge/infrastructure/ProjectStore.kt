package dev.forge.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DataSourceTransactionManager
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate

/** The database owns record CAS; immutable content objects are written before references commit. */
@Component
class ProjectStore(config: ForgeConfig, private val contracts: Contracts) {
    private val objects = config.data.resolve("objects")
    private val db: JdbcTemplate
    private val transactions: TransactionTemplate
    private val guard = Any()
    val issues = mutableListOf<ObjectNode>()

    init {
        Files.createDirectories(objects)
        val url = config.get("DATABASE_URL", "jdbc:sqlite:${config.data.resolve("forge.db")}")
        val ds =
            object :
                DriverManagerDataSource(
                    url,
                    config.get("DATABASE_USER"),
                    config.get("DATABASE_PASSWORD"),
                ) {
                override fun getConnection(): java.sql.Connection =
                    super.getConnection().also { c ->
                        if (url.startsWith("jdbc:sqlite:"))
                            c.createStatement().use {
                                it.execute("PRAGMA busy_timeout=10000")
                                it.execute("PRAGMA foreign_keys=ON")
                            }
                    }
            }
        db = JdbcTemplate(ds)
        transactions = TransactionTemplate(DataSourceTransactionManager(ds))
        if (url.startsWith("jdbc:sqlite:")) db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            "CREATE TABLE IF NOT EXISTS forge_projects (id VARCHAR(36) PRIMARY KEY, create_request_id VARCHAR(36) NOT NULL UNIQUE, store_version BIGINT NOT NULL, payload TEXT NOT NULL)"
        )
    }

    private fun put(value: JsonNode): String {
        val bytes = value.toString().toByteArray()
        val digest = sha(bytes)
        val path = objects.resolve("$digest.json")
        if (!Files.exists(path)) {
            val temp = Files.createTempFile(objects, "object-", ".tmp")
            try {
                Files.write(temp, bytes, StandardOpenOption.TRUNCATE_EXISTING)
                Files.move(
                    temp,
                    path,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } finally {
                Files.deleteIfExists(temp)
            }
        } else requireApi(sha(Files.readAllBytes(path)) == digest, "内容对象校验失败", 500)
        return digest
    }

    private fun readObject(hash: String): JsonNode {
        requireApi(hash.matches(Regex("[a-f0-9]{64}")), "内容引用无效", 500)
        val bytes = Files.readAllBytes(objects.resolve("$hash.json"))
        requireApi(sha(bytes) == hash, "内容对象校验失败", 500)
        return mapper.readTree(bytes)
    }

    private fun encode(record: ObjectNode): String {
        val result = record.copyObject()
        val project = result.o("project")
        result.v("contentObject", put(project.path("content")))
        project.remove("content")
        result.v("history", record.a("history").map { put(it) })
        (result.get("checkpoint") as? ObjectNode)?.let { it.v("content", put(it.path("content"))) }
        (result.get("conversation") as? ObjectNode)?.let { it.v("messages", put(it.a("messages"))) }
        result.remove("_storeVersion")
        result.v("storageVersion", 1)
        return result.toString()
    }

    private fun decode(payload: String, version: Long): ObjectNode {
        val r = parse(payload).copyObject()
        r.o("project").v("content", readObject(r.s("contentObject")))
        r.v("history", r.a("history").map { readObject(it.asText()) })
        (r.get("checkpoint") as? ObjectNode)?.let { it.v("content", readObject(it.s("content"))) }
        (r.get("conversation") as? ObjectNode)?.let {
            it.v("messages", readObject(it.s("messages")))
        }
        return r.v("_storeVersion", version)
    }

    fun get(id: String): ObjectNode =
        synchronized(guard) {
            db.query(
                    "SELECT payload,store_version FROM forge_projects WHERE id=?",
                    { rs, _ -> decode(rs.getString(1), rs.getLong(2)) },
                    id,
                )
                .firstOrNull() ?: throw ApiError(404, "项目不存在")
        }

    fun all(): List<ObjectNode> =
        synchronized(guard) {
            db.query("SELECT id,payload,store_version FROM forge_projects") { rs, _ ->
                    runCatching { decode(rs.getString(2), rs.getLong(3)) }
                        .getOrElse {
                            val issue =
                                obj("file" to rs.getString(1), "reason" to "项目内容对象无法读取或校验失败")
                            if (issues.none { previous -> previous.s("file") == issue.s("file") })
                                issues.add(issue)
                            null
                        }
                }
                .filterNotNull()
        }

    /** Poll small manifests only; never reload and hash every HTML object on a timer. */
    fun pendingIds(kind: String): List<String> =
        synchronized(guard) {
            require(kind == "commands")
            db.query(
                    "SELECT id,payload FROM forge_projects WHERE payload LIKE ?",
                    { rs, _ ->
                        val queue = parse(rs.getString(2)).a(kind)
                        val eligible = queue.firstOrNull()?.s("status") == "queued"
                        if (eligible) rs.getString(1) else null
                    },
                    "%\"status\":\"queued\"%",
                )
                .filterNotNull()
        }

    fun findCreated(requestId: String): ObjectNode? =
        synchronized(guard) {
            db.query(
                    "SELECT payload,store_version FROM forge_projects WHERE create_request_id=?",
                    { rs, _ -> decode(rs.getString(1), rs.getLong(2)) },
                    requestId,
                )
                .firstOrNull()
        }

    fun <T> update(id: String, touch: Boolean = true, change: (ObjectNode) -> T): T =
        synchronized(guard) {
            transactions
                .execute {
                    val record = get(id)
                    val result = change(record)
                    save(record, touch)
                    result to Unit
                }!!
                .first
        }

    fun create(record: ObjectNode): ObjectNode =
        synchronized(guard) {
            contracts.check("htmlProjectSchema", record.path("project"))
            record.get("conversation")?.let { contracts.check("conversationSchema", it) }
            db.update(
                "INSERT INTO forge_projects(id,create_request_id,store_version,payload) VALUES(?,?,0,?)",
                record.o("project").s("id"),
                record.s("createRequestId"),
                encode(record),
            )
            record.o("project").copyObject()
        }

    private fun save(record: ObjectNode, touch: Boolean) {
        val p = record.o("project")
        p.v("undoDepth", record.a("history").size())
        if (touch) p.v("updatedAt", now())
        contracts.check("htmlProjectSchema", p)
        (record.get("conversation") as? ObjectNode)?.let {
            contracts.check("conversationSchema", it)
        }
        val expected = record.path("_storeVersion").asLong()
        requireApi(
            db.update(
                "UPDATE forge_projects SET payload=?,store_version=store_version+1 WHERE id=? AND store_version=?",
                encode(record),
                p.s("id"),
                expected,
            ) == 1,
            "项目正在被其他进程更新，请重试",
            409,
        )
    }

    fun delete(id: String, expected: Int): ObjectNode =
        synchronized(guard) {
            transactions.execute {
                val r = get(id)
                revision(r.o("project"), expected)
                db.update(
                    "DELETE FROM forge_projects WHERE id=? AND store_version=?",
                    id,
                    r.path("_storeVersion").asLong(),
                )
                obj("deleted" to true)
            }!!
        }

    fun remember(r: ObjectNode) {
        r.v(
            "history",
            (r.a("history").toList() + listOf(r.o("project").path("content").copyObject()))
                .takeLast(20),
        )
    }

    fun operation(r: ObjectNode, id: String) {
        r.v("operations", (r.a("operations").map { it.asText() } + id).takeLast(100))
    }

    fun hasOperation(r: JsonNode, id: String) = r.a("operations").any { it.asText() == id }

    /**
     * Read-only legacy source. Import into a fresh database; one corrupt project cannot hide
     * others.
     */
    fun importLegacy(directory: Path): ObjectNode {
        var imported = 0
        val problems = mutableListOf<ObjectNode>()
        Files.list(directory).use { paths ->
            paths
                .filter { it.fileName.toString().matches(Regex("[a-fA-F0-9-]{36}\\.json")) }
                .sorted()
                .forEach { path ->
                    try {
                        fun load(p: Path): ObjectNode {
                            val raw = parse(Files.readString(p)).copyObject()
                            if (raw.has("schemaVersion")) {
                                requireApi(raw.i("schemaVersion") == 2, "未知旧版存储格式")
                                fun ref(hash: String): JsonNode {
                                    requireApi(hash.matches(Regex("[a-f0-9]{64}")), "无效旧版引用")
                                    val b =
                                        Files.readAllBytes(directory.resolve("objects/$hash.json"))
                                    requireApi(sha(b) == hash, "旧版对象校验失败")
                                    return mapper.readTree(b)
                                }
                                raw.o("project").v("content", ref(raw.s("content")))
                                raw.v("history", raw.a("history").map { ref(it.asText()) })
                                (raw.get("conversation") as? ObjectNode)?.let {
                                    it.v("messages", ref(it.s("messages")))
                                }
                                (raw.get("checkpoint") as? ObjectNode)?.let {
                                    it.v("content", ref(it.s("content")))
                                }
                            }
                            requireApi(
                                raw.o("project").s("id") ==
                                    path.fileName.toString().removeSuffix(".json"),
                                "旧项目标识不一致",
                            )
                            return raw
                        }
                        val record =
                            try {
                                load(path)
                            } catch (e: Exception) {
                                if (e is ApiError && e.message == "未知旧版存储格式") throw e
                                load(
                                    path.resolveSibling(
                                        path.fileName.toString().removeSuffix(".json") +
                                            ".previous.json"
                                    )
                                )
                            }
                        if (findCreated(record.s("createRequestId")) == null) {
                            create(record)
                            imported++
                        }
                    } catch (e: Exception) {
                        problems +=
                            obj("file" to path.fileName.toString(), "reason" to "导入失败：格式、校验或标识冲突")
                    }
                }
        }
        issues.addAll(problems)
        return obj("imported" to imported, "issues" to problems)
    }
}
