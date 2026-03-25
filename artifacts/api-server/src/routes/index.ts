import { Router, type IRouter } from "express";
import healthRouter from "./health";
import photoRouter from "./photo";
import generateRouter from "./generate";
import videoRouter from "./video";

const router: IRouter = Router();

router.use(healthRouter);
router.use(photoRouter);
router.use(generateRouter);
router.use(videoRouter);

export default router;
