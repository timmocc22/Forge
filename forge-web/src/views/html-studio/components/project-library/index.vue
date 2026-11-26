<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ProjectSummary } from '../../../../services/html-projects';
import Icon from '../../../../components/icon/index.vue';
const props = withDefaults(
  defineProps<{
    projects: ProjectSummary[];
    currentId?: string;
    busy: boolean;
    loading: boolean;
    mode?: 'works' | 'conversations';
    expanded?: boolean;
  }>(),
  { mode: 'works', expanded: false, currentId: undefined },
);
const emit = defineEmits<{
  open: [id: string];
  create: [];
  collapse: [];
  expand: [];
  manage: [id: string, operation: 'archive' | 'restore' | 'duplicate' | 'delete'];
}>();
const showArchived = ref(false);
const menu = ref<{ item: ProjectSummary; x: number; y: number }>();
const menuElement = ref<HTMLElement>();
let menuTrigger: HTMLElement | undefined;
function closeMenu(restoreFocus = false) {
  menu.value = undefined;
  if (restoreFocus) menuTrigger?.focus();
}
async function openMenu(event: MouseEvent | KeyboardEvent, item: ProjectSummary) {
  if (!historyMode.value || props.busy) return;
  event.preventDefault();
  menuTrigger = event.currentTarget as HTMLElement;
  const bounds = menuTrigger.getBoundingClientRect();
  const pointer = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
  menu.value = {
    item,
    x: Math.max(8, Math.min(pointer ? event.clientX : bounds.left, window.innerWidth - 192)),
    y: Math.max(8, Math.min(pointer ? event.clientY : bounds.bottom, window.innerHeight - 148)),
  };
  await nextTick();
  if (!menu.value || !menuElement.value) return;
  const size = menuElement.value.getBoundingClientRect();
  menu.value.x = Math.max(8, Math.min(menu.value.x, window.innerWidth - size.width - 8));
  menu.value.y = Math.max(8, Math.min(menu.value.y, window.innerHeight - size.height - 8));
  (
    menuElement.value.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? menuElement.value
  ).focus();
}
function selectAction(operation: 'archive' | 'restore' | 'duplicate' | 'delete') {
  if (!menu.value || props.busy) return;
  const id = menu.value.item.id;
  closeMenu(true);
  emit('manage', id, operation);
}
function outsideMenu(event: PointerEvent) {
  if (!menuElement.value?.contains(event.target as Node)) closeMenu();
}
function menuKey(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    closeMenu(true);
    if (event.key === 'Escape') event.preventDefault();
    return;
  }
  const buttons = [
    ...(menuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let index: number;
  if (event.key === 'ArrowDown') index = (current + 1) % buttons.length;
  else if (event.key === 'ArrowUp') index = (current - 1 + buttons.length) % buttons.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = buttons.length - 1;
  else return;
  event.preventDefault();
  buttons[index]?.focus();
}
function dismissMenu() {
  closeMenu();
}
onMounted(() => {
  window.addEventListener('pointerdown', outsideMenu);
  window.addEventListener('resize', dismissMenu);
  window.addEventListener('scroll', dismissMenu, true);
});
onUnmounted(() => {
  window.removeEventListener('pointerdown', outsideMenu);
  window.removeEventListener('resize', dismissMenu);
  window.removeEventListener('scroll', dismissMenu, true);
});
const query = ref('');
const historyMode = computed(() => props.mode === 'conversations');
const title = computed(() => (historyMode.value ? '对话历史' : '作品侧栏'));
const expandLabel = computed(
  () => `${props.expanded ? '还原' : '扩张'}${title.value}${props.expanded ? '宽度' : ''}`,
);
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return props.projects
    .filter((item) => !historyMode.value || !!item.archived === showArchived.value)
    .filter((item) => !search || `${item.title} ${item.brief}`.toLocaleLowerCase().includes(search))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
});
const groups = computed(() => {
  if (!historyMode.value) return [{ label: '', items: filtered.value }];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return [
    { label: '今天', items: filtered.value.filter((item) => new Date(item.updatedAt) >= today) },
    {
      label: '昨天',
      items: filtered.value.filter(
        (item) => new Date(item.updatedAt) >= yesterday && new Date(item.updatedAt) < today,
      ),
    },
    { label: '更早', items: filtered.value.filter((item) => new Date(item.updatedAt) < yesterday) },
  ].filter((group) => group.items.length);
});
function updatedTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
watch(
  () => props.mode,
  () => {
    query.value = '';
    showArchived.value = false;
    closeMenu();
  },
);
watch(
  () => props.busy,
  () => closeMenu(),
);
watch(showArchived, () => closeMenu());
</script>
<template>
  <aside class="project-library" :aria-label="title">
    <header>
      <h2>{{ historyMode ? '对话历史' : '作品' }}</h2>
      <div>
        <button
          :aria-label="expandLabel"
          :title="expandLabel"
          :aria-pressed="expanded"
          @click="$emit('expand')"
        >
          <Icon :name="expanded ? 'collapse' : 'expand'" :size="15" /></button
        ><button :aria-label="`收起${title}`" :title="`收起${title}`" @click="$emit('collapse')">
          <Icon name="panel-left" :size="17" />
        </button>
      </div>
    </header>
    <button
      class="library-create"
      :disabled="busy"
      :aria-label="historyMode ? '创建新对话' : '新建创作'"
      @click="$emit('create')"
    >
      <span>＋</span>{{ historyMode ? '新建对话' : '新建创作' }}
    </button>
    <label class="library-search"
      ><Icon name="search" :size="15" /><input
        v-model="query"
        :aria-label="historyMode ? '搜索对话历史' : '搜索作品'"
        :placeholder="historyMode ? '搜索对话' : '搜索作品'"
    /></label>
    <div v-if="historyMode" class="library-tabs" aria-label="会话范围">
      <button :aria-pressed="!showArchived" @click="showArchived = false">全部会话</button>
      <button :aria-pressed="showArchived" @click="showArchived = true">已归档</button>
    </div>
    <div class="library-list" :aria-busy="loading">
      <p v-if="loading">正在载入…</p>
      <template v-else>
        <div v-for="group in groups" :key="group.label" class="library-group">
          <h3 v-if="group.label">{{ group.label }}</h3>
          <button
            v-for="item in group.items"
            :key="item.id"
            class="library-item"
            :class="{ selected: currentId === item.id }"
            :disabled="busy"
            :aria-label="`${historyMode ? '打开对话' : '打开作品'}：${item.title}`"
            :aria-current="currentId === item.id ? 'true' : undefined"
            :aria-haspopup="historyMode ? 'menu' : undefined"
            @contextmenu="openMenu($event, item)"
            @keydown.shift.f10="openMenu($event, item)"
            @click="$emit('open', item.id)"
          >
            <Icon :name="historyMode ? 'chat' : 'code'" :size="17" /><span
              ><strong>{{ item.title }}</strong
              ><span v-if="item.brief !== item.title" class="library-excerpt">{{ item.brief }}</span
              ><small
                ><span>{{
                  item.running ? '正在创作' : `${item.builtCount} / ${item.sceneCount} 页`
                }}</span
                ><time v-if="historyMode" :datetime="item.updatedAt">{{
                  updatedTime(item.updatedAt)
                }}</time></small
              ></span
            >
          </button>
        </div>
        <div v-if="!projects.length" class="library-empty">
          <Icon :name="historyMode ? 'chat' : 'folder'" :size="28" />
          <p>{{ historyMode ? '还没有对话记录' : '还没有作品' }}</p>
          <span v-if="historyMode">开始一次对话，灵感会留在这里</span>
        </div>
        <p v-else-if="!filtered.length">
          {{
            historyMode ? (showArchived ? '没有已归档的会话' : '没有匹配的对话') : '没有匹配的作品'
          }}
        </p>
      </template>
    </div>
  </aside>
  <Teleport to="body">
    <div
      v-if="menu"
      ref="menuElement"
      class="session-menu"
      role="menu"
      tabindex="-1"
      aria-label="会话操作"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @keydown="menuKey"
      @contextmenu.prevent
    >
      <button
        role="menuitem"
        :disabled="busy || menu.item.running"
        @click="selectAction('duplicate')"
      >
        复制会话
      </button>
      <button
        role="menuitem"
        :disabled="busy || menu.item.running"
        @click="selectAction(menu.item.archived ? 'restore' : 'archive')"
      >
        {{ menu.item.archived ? '取消归档' : '归档会话' }}
      </button>
      <button
        role="menuitem"
        class="danger"
        :disabled="busy || menu.item.running"
        @click="selectAction('delete')"
      >
        删除会话
      </button>
      <small v-if="menu.item.running">请先停止生成</small>
    </div>
  </Teleport>
</template>
<style scoped lang="less">
.session-menu {
  position: fixed;
  z-index: 1000;
  width: 184px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--background);
  color: var(--text);
  box-shadow: 0 8px 28px #0002;
  button {
    display: block;
    width: 100%;
    min-height: 40px;
    padding: 8px 12px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: 12px;
    &:hover,
    &:focus-visible {
      background: var(--hover);
    }
    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    &.danger {
      color: #d44c47;
    }
  }
  small {
    display: block;
    padding: 5px 12px;
    color: var(--muted);
    font-size: 11px;
  }
}
.library-tabs {
  display: flex;
  gap: 4px;
  padding: 0 16px 12px;
  button {
    border: 0;
    border-radius: 5px;
    padding: 6px 9px;
    font-size: 11px;
    color: var(--muted);
    background: transparent;
    &[aria-pressed='true'] {
      color: var(--text);
      background: var(--hover);
    }
  }
}

.project-library {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--sidebar);
  header {
    height: 56px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    h2 {
      font-size: 13px;
      font-weight: 500;
      margin: 0;
    }
    div {
      display: flex;
      gap: 2px;
    }
    button {
      display: grid;
      place-items: center;
      width: 28px;
      height: 30px;
      border: 0;
      border-radius: 5px;
      color: var(--muted);
      background: transparent;
      &:hover {
        background: var(--hover);
      }
    }
  }
}
.library-create {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px 16px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  font-size: 12px;
  text-align: left;
  span {
    font-size: 18px;
    line-height: 1;
  }
}
.library-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 18px;
  color: var(--subtle);
  input {
    min-width: 0;
    width: 100%;
    padding: 5px 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 11px;
    outline-offset: 3px;
  }
}
.library-list {
  overflow: auto;
  min-height: 0;
  padding: 0 8px 20px;
  p {
    padding: 15px 12px;
    font-size: 11px;
    color: var(--subtle);
  }
}
.library-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 12px 10px;
  border: 0;
  background: transparent;
  border-radius: 8px;
  text-align: left;
  color: var(--muted);
  svg {
    margin-top: 2px;
    flex-shrink: 0;
  }
  span {
    min-width: 0;
    flex: 1;
  }
  strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 400;
    color: var(--text);
    line-height: 1.8;
  }
  small {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 8px;
    margin-top: 3px;
    font-size: 10px;
    color: var(--subtle);
  }
  time {
    white-space: nowrap;
  }
  .library-excerpt {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    margin-top: 3px;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.6;
  }
  &:hover,
  &.selected {
    background: var(--hover);
  }
}
.library-create:disabled,
.library-item:disabled {
  opacity: 1;
  cursor: wait;
}
.library-group h3 {
  margin: 12px 12px 6px;
  color: var(--subtle);
  font-size: 10px;
  font-weight: 400;
}
.library-empty {
  padding: 36px 12px;
  text-align: center;
  color: var(--subtle);
  p {
    margin: 12px 0 8px;
    padding: 0;
    font-size: 12px;
  }
  > span {
    font-size: 10px;
    line-height: 1.8;
  }
}
@media (pointer: coarse) {
  .project-library header button {
    width: 40px;
    height: 40px;
  }
}
</style>
