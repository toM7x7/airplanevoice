import "./index.css";
import { MyComposition } from "./Composition";
import { DevelopmentCompositions } from "./development-pv";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <DevelopmentCompositions />
    </>
  );
};
