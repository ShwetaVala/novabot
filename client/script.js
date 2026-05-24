const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");

let sessionId = localStorage.getItem("novaSessionId") || null;
let busy = false;

function addMessage(text, role) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
  messageInput.disabled = value;
}

async function readStream(res, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = JSON.parse(line.slice(6));
      if (payload.chunk) onChunk(payload.chunk);
      if (payload.error) throw new Error(payload.error);
      if (payload.done && payload.sessionId) {
        sessionId = payload.sessionId;
        localStorage.setItem("novaSessionId", sessionId);
      }
    }
  }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = messageInput.value.trim();
  if (!message || busy) return;

  messageInput.value = "";
  addMessage(message, "user");
  setBusy(true);

  const replyEl = addMessage("", "nova typing");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId, stream: true }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const data = await res.json();
      replyEl.remove();
      addMessage(data.error || "Something went wrong.", "error");
      return;
    }

    replyEl.className = "message nova";
    let text = "";

    await readStream(res, (chunk) => {
      text += chunk;
      replyEl.textContent = text;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });

    if (!text) replyEl.textContent = " ";
  } catch (err) {
    replyEl.remove();
    if (err.name === "TimeoutError") {
      addMessage("Request timed out. Please try again.", "error");
    } else if (err.message?.includes("limit") || err.message?.includes("busy")) {
      addMessage(err.message, "error");
    } else {
      addMessage(
        err.message || "Cannot reach the server. Run: npm start (in server/)",
        "error"
      );
    }
  } finally {
    setBusy(false);
    messageInput.focus();
  }
});

clearBtn.addEventListener("click", async () => {
  if (sessionId) {
    await fetch("/api/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  }

  sessionId = null;
  localStorage.removeItem("novaSessionId");
  messagesEl.innerHTML = "";
  addMessage(
    "Hey! I'm Nova — ready to help with your day, study, and goals. What's on your mind?",
    "nova"
  );
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

addMessage(
  "Hey! I'm Nova — ready to help with your day, study, and goals. What's on your mind?",
  "nova"
);
