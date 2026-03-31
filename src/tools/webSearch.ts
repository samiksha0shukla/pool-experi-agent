/**
 * WEB SEARCH — Uses Google Custom Search API for real web results.
 *
 * This is the foundation all transport tools build on.
 * Returns actual search results from Google, not LLM hallucinations.
 */

import dotenv from "dotenv";
dotenv.config();

export interface WebSearchResult {
  title: string;
  snippet: string;
  link: string;
}

export async function webSearch(query: string, numResults = 5): Promise<WebSearchResult[]> {
  const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;

  if (!apiKey || !engineId) {
    throw new Error("GOOGLE_CUSTOM_SEARCH_API_KEY and GOOGLE_CUSTOM_SEARCH_ENGINE_ID must be set in .env");
  }

  const params = new URLSearchParams({
    key: apiKey,
    cx: engineId,
    q: query,
    num: String(Math.min(numResults, 10)),
  });

  const url = `https://www.googleapis.com/customsearch/v1?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Search API error (${response.status}): ${errText}`);
  }

  const data = await response.json() as { items?: Array<{ title: string; snippet: string; link: string }> };

  if (!data.items || data.items.length === 0) {
    return [];
  }

  return data.items.map((item) => ({
    title: item.title,
    snippet: item.snippet,
    link: item.link,
  }));
}
