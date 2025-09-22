# Battleship API Documentation

This folder contains the API documentation for the **Battleship Project**.  
The documentation is based on the **OpenAPI Specification (OAS)**.

---

## 📖 Contents
- `openapi.yaml` – OpenAPI 3.0 specification file describing all endpoints.
- `index.html` (optional) – Bundled static documentation (if generated via [Redoc](https://github.com/Redocly/redoc) or [Swagger UI](https://swagger.io/tools/swagger-ui/)).

---

## 🚀 Viewing the Documentation

### Option 1: Using Redoc (recommended)
Run the following command to serve the documentation locally:

```bash
npm run docs:serve
```
### This will spin up a local server and render the docs in a clean UI.

Option 2: Using Swagger UI
If you prefer Swagger UI:

```bash
docker run -p 8080:8080 -v $(pwd)/docs:/usr/share/nginx/html/swagger -e SWAGGER_JSON=/usr/share/nginx/html/swagger/openapi.yaml swaggerapi/swagger-ui
```
Open `http://localhost:8080` to view.

## 📌 Adding/Updating Endpoints
Edit openapi.yaml and add/update your endpoint specification.

Run validation:

```bash
npx @redocly/cli lint docs/openapi.yaml
```
Commit changes with a clear message, e.g.:

```sql
git commit -m "docs(api): add /games/{id}/state endpoint"

```

## 🔧 Generating Static Docs
To build a static HTML version of the API docs:

```bash
npm run docs:build
```
This will create `docs/index.html`, which can be hosted on any static server or integrated into the app.

## 📬 Feedback
If you notice inconsistencies between the code and docs, please:

* Open an issue in the repository, or
* Submit a pull request with suggested fixes.
* Maintainers: Keep the docs in sync with the codebase to ensure reliable integration for developers.