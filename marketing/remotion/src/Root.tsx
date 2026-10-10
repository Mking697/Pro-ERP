import { Composition } from "remotion";
import { ProErpExplainer, TOTAL_DURATION_FRAMES, FPS } from "./ProErpExplainer";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ProErpExplainer-16x9"
        component={ProErpExplainer}
        durationInFrames={TOTAL_DURATION_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ ratio: "16:9" as const }}
      />
      <Composition
        id="ProErpExplainer-9x16"
        component={ProErpExplainer}
        durationInFrames={TOTAL_DURATION_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ ratio: "9:16" as const }}
      />
      <Composition
        id="ProErpExplainer-1x1"
        component={ProErpExplainer}
        durationInFrames={TOTAL_DURATION_FRAMES}
        fps={FPS}
        width={1080}
        height={1080}
        defaultProps={{ ratio: "1:1" as const }}
      />
    </>
  );
};
