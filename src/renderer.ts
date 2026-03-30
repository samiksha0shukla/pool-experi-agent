import fs from "fs/promises";
import path from "path";
import { getResponsesDir } from "./store.js";

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToHTML(md: string): string {
  let html = escapeHTML(md);

  // Headers
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');

  // Links
  html = html.replace(
    /\[(.+?)\]\((.+?)\)/g,
    '<a href="$2" target="_blank">$1</a>'
  );

  // Bare URLs
  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" class="link">$1</a>'
  );

  // List items
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Numbered list
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs (lines not already tagged)
  html = html.replace(/^(?!<[hulo]|<li|<hr)(.+)$/gm, '<p>$1</p>');

  // Clean empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

function getIntentTheme(intent: string): { accent: string; icon: string; label: string } {
  switch (intent) {
    case "music":
      return { accent: "#1DB954", icon: "🎵", label: "Music Agent" };
    case "travel":
      return { accent: "#0984E3", icon: "✈️", label: "Travel Agent" };
    case "profile":
      return { accent: "#6C5CE7", icon: "👤", label: "Profile" };
    default:
      return { accent: "#A29BFE", icon: "💬", label: "Pool Agent" };
  }
}

function buildHTML(
  content: string,
  intent: string,
  query: string
): string {
  const theme = getIntentTheme(intent);
  const bodyHTML = markdownToHTML(content);
  const timestamp = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pool Agent — ${theme.label}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e0e0e8;
      min-height: 100vh;
      padding: 0;
    }

    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border-bottom: 2px solid ${theme.accent}33;
      padding: 24px 40px;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .header-icon {
      font-size: 32px;
      width: 56px;
      height: 56px;
      background: ${theme.accent}22;
      border: 1px solid ${theme.accent}44;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .header-text h1 {
      font-size: 20px;
      font-weight: 700;
      color: #fff;
    }

    .header-text .subtitle {
      font-size: 13px;
      color: #888;
      margin-top: 2px;
    }

    .badge {
      background: ${theme.accent}22;
      color: ${theme.accent};
      border: 1px solid ${theme.accent}44;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-left: auto;
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 32px 40px 60px;
    }

    .query-box {
      background: #12121a;
      border: 1px solid #2a2a3a;
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 32px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .query-label {
      color: ${theme.accent};
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      margin-top: 1px;
    }

    .query-text {
      color: #ccc;
      font-size: 15px;
      line-height: 1.5;
    }

    .response {
      background: #12121a;
      border: 1px solid #2a2a3a;
      border-radius: 12px;
      padding: 32px;
    }

    .response h2 {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #2a2a3a;
    }

    .response h3 {
      font-size: 17px;
      font-weight: 600;
      color: ${theme.accent};
      margin: 20px 0 10px;
    }

    .response p {
      font-size: 15px;
      line-height: 1.7;
      color: #c0c0cc;
      margin-bottom: 12px;
    }

    .response strong {
      color: #fff;
      font-weight: 600;
    }

    .response em {
      color: #888;
      font-style: italic;
    }

    .response ul {
      list-style: none;
      padding: 0;
      margin: 12px 0;
    }

    .response li {
      padding: 8px 0 8px 20px;
      position: relative;
      font-size: 15px;
      line-height: 1.6;
      color: #c0c0cc;
    }

    .response li::before {
      content: "›";
      position: absolute;
      left: 0;
      color: ${theme.accent};
      font-weight: bold;
      font-size: 18px;
    }

    .response hr {
      border: none;
      border-top: 1px solid #2a2a3a;
      margin: 24px 0;
    }

    .response code {
      background: #1e1e2e;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 13px;
      color: ${theme.accent};
      font-family: 'SF Mono', Consolas, monospace;
    }

    .response a, .response .link {
      color: ${theme.accent};
      text-decoration: none;
      border-bottom: 1px solid ${theme.accent}44;
      transition: border-color 0.2s;
    }

    .response a:hover {
      border-color: ${theme.accent};
    }

    .footer {
      text-align: center;
      padding: 24px;
      color: #444;
      font-size: 12px;
    }

    .footer span {
      color: ${theme.accent}88;
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-icon">${theme.icon}</div>
    <div class="header-text">
      <h1>Pool Agent</h1>
      <div class="subtitle">${theme.label} Response</div>
    </div>
    <div class="badge">${timestamp}</div>
  </div>

  <div class="container">
    <div class="query-box">
      <span class="query-label">You asked →</span>
      <span class="query-text">${escapeHTML(query)}</span>
    </div>

    <div class="response">
      ${bodyHTML}
    </div>
  </div>

  <div class="footer">
    Generated by <span>Pool Agent v1.0</span> · Screenshot Intelligence Agent
  </div>

</body>
</html>`;
}

export async function renderToHTML(
  content: string,
  intent: string,
  query: string
): Promise<string> {
  const dir = getResponsesDir();
  await fs.mkdir(dir, { recursive: true });

  const fileName = `response_${Date.now()}.html`;
  const filePath = path.join(dir, fileName);
  const html = buildHTML(content, intent, query);

  await fs.writeFile(filePath, html, "utf-8");
  return filePath;
}
