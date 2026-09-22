import {TransitionSeries} from '@remotion/transitions';
import {Hero} from './Hero';
import {Create} from './Create';
import {Assistant} from './Assistant';
import {Context} from './Context';
import {Quest} from './Quest';
import {Closing} from './Closing';
import {Sequence} from 'remotion';

/** A selected-cut edition, retaining normal motion speed and evidence labels. */
export const DevelopmentShort=()=> <TransitionSeries>
 <TransitionSeries.Sequence durationInFrames={150} name="コンセプト"><Hero/></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={120} name="制作"><Sequence trimBefore={75}><Create/></Sequence></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={150} name="AI操作案内"><Sequence trimBefore={115}><Assistant/></Sequence></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={150} name="Jevの役割"><Sequence trimBefore={90}><Context/></Sequence></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={180} name="Quest実機"><Sequence trimBefore={15}><Quest/></Sequence></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={150} name="締め"><Closing/></TransitionSeries.Sequence>
 </TransitionSeries>;
