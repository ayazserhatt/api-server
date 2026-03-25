import { Router, type IRouter } from "express";
import Replicate from "replicate";
import multer from "multer";

const router: IRouter = Router();
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function bufferToFile(buffer: Buffer, mimetype: string, filename: string): File {
  const blob = new Blob([buffer], { type: mimetype });
  return new File([blob], filename, { type: mimetype });
}

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

const VIDEO_PROMPT_ENHANCER: Record<string, string> = {
  portrait: "subject slowly turns head, gentle smile, hair softly moving in breeze, cinematic portrait motion, realistic",
  lifestyle: "natural movement, walking forward, looking around, vibrant atmosphere, smooth camera motion",
  dramatic: "dramatic cinematic camera movement, slow zoom in, atmospheric lighting changes, epic feel",
  dance: "subject is dancing gracefully, smooth fluid motion, joyful energy",
  default: "smooth subtle motion, natural realistic movement, cinematic quality, high detail",
};

function buildVideoPrompt(userPrompt: string, style?: string): string {
  const baseMotion =
    style && VIDEO_PROMPT_ENHANCER[style]
      ? VIDEO_PROMPT_ENHANCER[style]
      : VIDEO_PROMPT_ENHANCER.default;
  return `${userPrompt}. ${baseMotion}`;
}

// POST /api/video/start — starts prediction, returns immediately with predictionId
router.post("/video/start", upload.single("image"), async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      res.status(500).json({ error: "REPLICATE_API_TOKEN eksik" });
      return;
    }

    const imageFile = req.file;
    const { prompt, style } = req.body as { prompt?: string; style?: string };

    if (!imageFile) {
      res.status(400).json({ error: "Görsel gerekli" });
      return;
    }

    if (!prompt?.trim()) {
      res.status(400).json({ error: "Prompt boş" });
      return;
    }

    const finalPrompt = buildVideoPrompt(prompt, style);
    const imageAsFile = bufferToFile(imageFile.buffer, imageFile.mimetype, imageFile.originalname);

    const prediction = await replicate.predictions.create({
      model: "minimax/video-01-live",
      input: {
        prompt: finalPrompt,
        first_frame_image: imageAsFile,
      },
    });

    res.json({ predictionId: prediction.id, status: prediction.status });
  } catch (err: unknown) {
    req.log.error({ err }, "Video start error");
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    res.status(500).json({ error: message });
  }
});

// GET /api/video/status/:id — poll prediction status
router.get("/video/status/:id", async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      res.status(500).json({ error: "REPLICATE_API_TOKEN eksik" });
      return;
    }

    const { id } = req.params as { id: string };
    const prediction = await replicate.predictions.get(id);

    if (prediction.status === "succeeded") {
      const videoUrl = await outputToUrl(prediction.output);
      res.json({ status: "succeeded", videoUrl });
      return;
    }

    if (prediction.status === "failed" || prediction.status === "canceled") {
      res.json({
        status: prediction.status,
        error: (prediction.error as string | undefined) ?? "Video üretimi başarısız",
      });
      return;
    }

    // starting | processing
    res.json({ status: prediction.status });
  } catch (err: unknown) {
    req.log.error({ err }, "Video status error");
    const message = err instanceof Error ? err.message : "Bilinmeyen hata";
    res.status(500).json({ error: message });
  }
});

export default router;
