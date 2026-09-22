import {Composition,Folder} from 'remotion';
import {TransitionSeries} from '@remotion/transitions';
import {Hero} from './Hero';
import {Create} from './Create';
import {Assistant} from './Assistant';
import {Context} from './Context';
import {Quest} from './Quest';
import {Closing} from './Closing';
import {DevelopmentShort} from './Short';
export const DevelopmentPV=()=> <TransitionSeries>
 <TransitionSeries.Sequence durationInFrames={240} name="原点"><Hero/></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={270} name="一機をつくる"><Create/></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={300} name="AI操作支援"><Assistant/></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={300} name="Jevの設計"><Context/></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={360} name="Quest実機"><Quest/></TransitionSeries.Sequence>
 <TransitionSeries.Sequence durationInFrames={330} name="これから"><Closing/></TransitionSeries.Sequence>
 </TransitionSeries>;
export const DevelopmentCompositions=()=> <>
 <Composition id="Development-PV-30" component={DevelopmentShort} durationInFrames={900} fps={30} width={1920} height={1080}/>
 <Composition id="Development-PV" component={DevelopmentPV} durationInFrames={1800} fps={30} width={1920} height={1080}/>
 <Folder name="Development-scenes">
 <Composition id="PV-Hero" component={Hero} durationInFrames={240} fps={30} width={1920} height={1080}/>
 <Composition id="PV-Create" component={Create} durationInFrames={270} fps={30} width={1920} height={1080}/>
 <Composition id="PV-Assistant" component={Assistant} durationInFrames={300} fps={30} width={1920} height={1080}/>
 <Composition id="PV-Context" component={Context} durationInFrames={300} fps={30} width={1920} height={1080}/>
 <Composition id="PV-Quest" component={Quest} durationInFrames={360} fps={30} width={1920} height={1080}/>
 <Composition id="PV-Closing" component={Closing} durationInFrames={330} fps={30} width={1920} height={1080}/>
 </Folder>
 </>;
