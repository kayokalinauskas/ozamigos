# Etapa 1: monta a interface (React + TypeScript) com o Node.
# O build grava em ../src/main/resources/static, a pasta que o Spring serve.
FROM node:26-alpine AS interface
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# O commit do deploy, que a interface mostra ao lado da versão (o Render passa as variáveis dele como argumentos do
# build). Um commit novo também refaz esta etapa sempre, sem depender do cache de build do Render.
ARG RENDER_GIT_COMMIT
RUN npm run build

# Etapa 2: compila o servidor Java com o JDK completo, já com a interface dentro.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /app
COPY . .
COPY --from=interface /app/src/main/resources/static src/main/resources/static
RUN chmod +x mvnw && ./mvnw -q -DskipTests package

# Etapa 3: só o necessário para rodar (JRE + o .jar), numa imagem menor.
FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
# Usa até 75% da memória do contêiner (o plano gratuito do Render tem 512 MB).
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
