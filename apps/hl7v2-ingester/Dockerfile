# ─────────────── Build stage ───────────────
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /workspace

# Cache dependencies first.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

# Build the application.
COPY src ./src
COPY checkstyle.xml .
RUN mvn -B -q clean package -DskipTests

# ─────────────── Runtime stage ───────────────
FROM eclipse-temurin:17-jre
WORKDIR /app

# Run as a non-root user.
RUN groupadd --system medflow && useradd --system --gid medflow medflow

COPY --from=build /workspace/target/hl7v2-ingester.jar /app/app.jar

USER medflow
# MLLP listener and HTTP/actuator.
EXPOSE 2575 8097

ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
