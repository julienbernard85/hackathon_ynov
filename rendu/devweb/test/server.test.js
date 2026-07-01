import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  extractInfraText,
  extractOpenAIText,
  extractTritonText,
  formatPhiPrompt,
  infraMessage,
  server,
  validateMessages
} from "../server.js";

test("formatPhiPrompt produit le template attendu par Phi-3.5", () => {
  assert.equal(
    formatPhiPrompt([
      { role: "user", content: "Bonjour" },
      { role: "assistant", content: "Bonjour !" }
    ]),
    "<|user|>\nBonjour<|end|>\n<|assistant|>\nBonjour !<|end|>\n<|assistant|>\n"
  );
});

test("extractTritonText lit la sortie text_output", () => {
  assert.equal(
    extractTritonText({ outputs: [{ name: "text_output", data: ["Une réponse"] }] }),
    "Une réponse"
  );
});

test("extractOpenAIText lit une réponse de l’API Responses", () => {
  assert.equal(
    extractOpenAIText({
      output: [{ content: [{ type: "output_text", text: "Analyse terminée" }] }]
    }),
    "Analyse terminée"
  );
});

test("le contrat du serveur Groq INFRA est correctement interprété", () => {
  assert.equal(extractInfraText({ response: "Réponse financière" }), "Réponse financière");
  assert.match(
    infraMessage([
      { role: "user", content: "Qu’est-ce qu’un ETF ?" },
      { role: "assistant", content: "Un fonds indiciel." },
      { role: "user", content: "Et ses risques ?" }
    ]),
    /Et ses risques/
  );
});

test("validateMessages refuse les messages vides", () => {
  assert.throws(() => validateMessages([{ role: "user", content: " " }]), /invalide/);
});

test("le proxy transmet le flux Ollama au navigateur", async () => {
  const mockOllama = http.createServer((request, response) => {
    assert.equal(request.url, "/api/chat");
    response.writeHead(200, { "Content-Type": "application/x-ndjson" });
    response.write(`${JSON.stringify({ message: { content: "Bonjour " }, done: false })}\n`);
    response.end(`${JSON.stringify({
      message: { content: "TechCorp" },
      done: true,
      prompt_eval_count: 8,
      eval_count: 2,
      total_duration: 15_000_000
    })}\n`);
  });

  await new Promise((resolve) => mockOllama.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const mockPort = mockOllama.address().port;
  const appPort = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          provider: "ollama",
          baseUrl: `http://127.0.0.1:${mockPort}`,
          model: "phi3.5-financial"
        },
        messages: [{ role: "user", content: "Bonjour" }]
      })
    });
    const stream = await response.text();
    assert.equal(response.status, 200);
    assert.match(stream, /Bonjour /);
    assert.match(stream, /TechCorp/);
    assert.match(stream, /"completionTokens":2/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockOllama.close(resolve));
  }
});
