# PSK Bank banking service. Plain JDK, no build tool: compile once at image build, run on a slim JRE.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY src ./src
RUN javac -d out $(find src -name '*.java')

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/out ./out
# Hosts like Render inject PORT; listen on all interfaces inside the container.
ENV BIND_HOST=0.0.0.0 PORT=8081
EXPOSE 8081
# Small heap fits a 512 MB free instance.
CMD ["java", "-XX:MaxRAMPercentage=70", "-cp", "out", "com.pskbank.demo.App"]
