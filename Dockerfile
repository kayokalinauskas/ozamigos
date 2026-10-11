# Etapa 1: compila o projeto com o JDK completo.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /app
COPY . .
RUN chmod +x mvnw && ./mvnw -q -DskipTests package

# Etapa 2: só o necessário para rodar (JRE + o .jar), numa imagem menor.
FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
# Usa até 75% da memória do contêiner (o plano gratuito do Render tem 512 MB).
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
