// local.js — local runner
import app from "./main.js";

console.log("Starting local server at http://localhost:8000");
Deno.serve({ port: 8000 }, app.fetch);
