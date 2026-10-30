import { callProtectedApi } from "./store.js?v=15";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function uploadStudyFile(file, purpose = "question") {
  const contentType = String(file?.type || "").toLowerCase();
  const isPdf = purpose === "notice" && contentType === "application/pdf";
  if (!isPdf && !IMAGE_TYPES.has(contentType)) {
    throw new Error("画像はJPEG・PNG・WebP形式を選択してください。");
  }
  const maximum = (isPdf ? 20 : 10) * 1024 * 1024;
  if (!Number(file?.size) || file.size > maximum) {
    throw new Error(isPdf ? "PDFは20MB以下にしてください。" : "画像は10MB以下にしてください。");
  }
  const authorization = await callProtectedApi("createStudyAppUploadSignature", {
    purpose,
    contentType,
    size: file.size,
  });
  const body = new FormData();
  body.append("file", file);
  body.append("api_key", authorization.apiKey);
  body.append("timestamp", String(authorization.timestamp));
  body.append("signature", authorization.signature);
  body.append("folder", authorization.folder);
  body.append("public_id", authorization.publicId);
  body.append("overwrite", "false");
  body.append("allowed_formats", authorization.allowedFormats);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const resourceType = authorization.resourceType === "raw" ? "raw" : "image";
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(authorization.cloudName)}/${resourceType}/upload`, {
      method: "POST",
      body,
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    const expectedPrefix = `https://res.cloudinary.com/${authorization.cloudName}/`;
    if (!response.ok || !String(result.secure_url || "").startsWith(expectedPrefix)) {
      throw new Error("ファイルを安全にアップロードできませんでした。");
    }
    return { secureUrl: result.secure_url, publicId: result.public_id || authorization.publicId };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("アップロードに時間がかかっています。もう一度お試しください。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
