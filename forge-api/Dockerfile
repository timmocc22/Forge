FROM eclipse-temurin:25-jdk AS build
WORKDIR /app
COPY . .
RUN chmod +x gradlew && ./gradlew build --no-daemon
FROM eclipse-temurin:25-jre
WORKDIR /app
ENV SERVER_ADDRESS=0.0.0.0 PORT=3009 DATA_DIR=/app/data
COPY --from=build /app/build/libs/forge-api-0.1.0.jar /app/forge-api.jar
EXPOSE 3009
ENTRYPOINT ["java", "--enable-native-access=ALL-UNNAMED", "-jar", "forge-api.jar"]
