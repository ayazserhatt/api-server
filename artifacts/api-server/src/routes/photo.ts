import { Router, type IRouter } from "express";
import Replicate from "replicate";
import multer from "multer";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

type Mode = "edit" | "portrait" | "scene" | "beauty" | "object";

async function outputToUrl(output: unknown): Promise<string> {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0] as unknown;
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "url" in first) {
      const urlProp = (first as { url?: unknown }).url;
      if (typeof urlProp === "function") return await (urlProp as () => Promise<string>)();
      if (typeof urlProp === "string") return urlProp;
    }
  }
  if (output && typeof output === "object" && "url" in output) {
    const urlProp = (output as { url?: unknown }).url;
    if (typeof urlProp === "function") return await (urlProp as () => Promise<string>)();
    if (typeof urlProp === "string") return urlProp;
  }
  return "";
}

function bufferToFile(buffer: Buffer, mimetype: string, filename: string): File {
  const blob = new Blob([buffer], { type: mimetype });
  return new File([blob], filename, { type: mimetype });
}

function buildPrompt(mode: Mode, userPrompt: string): string {
  const quality = "ultra realistic, photorealistic, high quality, sharp, professional";

  if (mode === "portrait") {
    return `You are a professional portrait & style transformation AI. Preserve the person's face identity, skin tone, and likeness EXACTLY. Only change: clothing, background, lighting, and environment as requested. No blur, no distortion, no fake look. Enhance: lighting quality, skin detail, professional look. ${quality}. User request: ${userPrompt}`;
  }

  if (mode === "scene") {
    return `You are an expert background and scene replacement AI. PRESERVE the subject (person/object) in the foreground EXACTLY as they are. COMPLETELY replace the background and environment with the requested scene. Match lighting and shadows to the new scene. Make it look photorealistic and natural. ${quality}. User request: ${userPrompt}`;
  }

  if (mode === "beauty") {
    return `You are a professional beauty and skin retouching AI. Apply natural, subtle beauty enhancements. Preserve facial identity and natural look. Enhance: skin smoothness and clarity, subtle lighting improvement, natural glow. Do NOT make it look artificial or plastic. Keep natural skin texture. ${quality}. User request: ${userPrompt}`;
  }

  if (mode === "object") {
    return `You are an expert AI inpainting model. The white masked area MUST be completely modified. NEVER ignore the masked area. ONLY modify the masked area. Match lighting, shadows and perspective perfectly. Blend naturally into the scene. ${quality}. User request: ${userPrompt}`;
  }

  // edit (default)
  return `You are a professional photo editor. Edit image with high realism, sharp details, clean quality. Preserve identity and key elements. Improve as requested: lighting, composition, colors, overall quality. ${quality}. User request: ${userPrompt}`;
}

router.post(
  "/edit",
  upload.fields([{ name: "image", maxCount: 1 }, { name: "mask", maxCount: 1 }]),
  async (req, res) => {
    try {
      if (!process.env.REPLICATE_API_TOKEN) {
        res.status(500).json({ error: "REPLICATE_API_TOKEN eksik" });
        return;
      }

      const files = req.files as Record<string, Express.Multer.File[]>;
      const imageFile = files?.["image"]?.[0];
      const maskFile = files?.["mask"]?.[0];

      const { prompt, mode: rawMode, quality: rawQuality } = req.body as {
        prompt?: string;
        mode?: string;
        quality?: string;
      };

      const validModes: Mode[] = ["edit", "portrait", "scene", "beauty", "object"];
      const mode: Mode = validModes.includes(rawMode as Mode) ? (rawMode as Mode) : "edit";

      if (!imageFile) {
        res.status(400).json({ error: "Görsel yok" });
        return;
      }

      if (!prompt?.trim()) {
        res.status(400).json({ error: "Prompt boş" });
        return;
      }

      const finalPrompt = buildPrompt(mode, prompt);
      const imageAsFile = bufferToFile(imageFile.buffer, imageFile.mimetype, imageFile.originalname);

      let output: unknown;

      if (mode === "object") {
        if (!maskFile) {
          res.status(400).json({ error: "Nesne modu için maske gerekli" });
          return;
        }
        const maskAsFile = bufferToFile(maskFile.buffer, maskFile.mimetype, "mask.png");
        output = await replicate.run("black-forest-labs/flux-fill-pro", {
          input: { image: imageAsFile, mask: maskAsFile, prompt: finalPrompt, output_format: "png" },
        });
      } else {
        output = await replicate.run("black-forest-labs/flux-kontext-max", {
          input: { input_image: imageAsFile, prompt: finalPrompt },
        });
      }

      const imageUrl = await outputToUrl(output);
      if (!imageUrl) {
        res.status(500).json({ error: "Görsel üretildi ama URL alınamadı" });
        return;
      }

      res.json({ imageUrl });
    } catch (err: unknown) {
      req.log.error({ err }, "Photo edit error");
      const message = err instanceof Error ? err.message : "Bilinmeyen hata";
      res.status(500).json({ error: message });
    }
  }
);

export default router;
