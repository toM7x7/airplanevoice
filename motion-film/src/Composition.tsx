import {
  Composition,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";
import { MotionStage } from "../../apps/desktop/src/ui/MotionArtwork";
import {
  reviewProgress,
  type MenuMotionStyle,
} from "../../packages/core/src/menu-motion";

type Props = { style: MenuMotionStyle; spatial: boolean };
export const MotionFilm = ({ style, spatial }: Props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  return (
    <>
      <MotionStage
        style={style}
        spatial={spatial}
        seconds={seconds}
        progress={reviewProgress(seconds)}
      />
      <Audio src={staticFile(`motion-audio/${style}.wav`)} />
    </>
  );
};
export const MyComposition = () => (
  <>
    {(["lift", "trail", "ripple"] as const).flatMap((style) =>
      [false, true].map((spatial) => (
        <Composition
          key={`${style}-${spatial}`}
          id={`${spatial ? "VR" : "PC"}-${style}`}
          component={MotionFilm}
          defaultProps={{ style, spatial }}
          durationInFrames={540}
          fps={60}
          width={1280}
          height={720}
        />
      )),
    )}
  </>
);
