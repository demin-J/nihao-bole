import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import { createWorker } from "tesseract.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

export async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  if (ext === ".pdf") {
    return extractPdfText(filePath);
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return extractImageText(filePath);
  }
  return "";
}

async function extractPdfText(filePath) {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return (data.text || "").trim();
}

async function extractImageText(filePath) {
  const worker = await createWorker("chi_sim+eng");
  try {
    const result = await worker.recognize(filePath);
    return (result?.data?.text || "").trim();
  } finally {
    await worker.terminate();
  }
}
