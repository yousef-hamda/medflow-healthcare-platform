# ─────────────── Build stage ───────────────
FROM maven:3-eclipse-temurin-26 AS build
WORKDIR /workspace

# Cache dependencies first.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

# Build the application.
COPY src ./src
COPY checkstyle.xml .
RUN mvn -B -q clean package -DskipTests

# ─────────────── Runtime stage ───────────────
FROM eclipse-temurin:25-jre
WORKDIR /app

# Run as a non-root user.
RUN groupadd --system medflow && useradd --system --gid medflow medflow

COPY --from=build /workspace/target/fhir-server.jar /app/app.jar

USER medflow
EXPOSE 8090

ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
