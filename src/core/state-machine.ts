import { z } from 'zod';

export const TimeWasterStateSchema = z.enum([
  'CONFUSED_CURIOUS', // Turn 1: 軽い相槌 + 曖昧な質問（仕組みを聞く）
  'DEEP_PROBING',     // Turn 2: 詳細・背景の深掘り（なぜ自分に？なぜおすすめ？）
  'HESITANT_CLOSING', // Turn 3: 困惑・慎重・手詰まり（難しそう、忙しいのでまた今度）
]);

export type TimeWasterState = z.infer<typeof TimeWasterStateSchema>;

/**
 * Determines the current conversational state for AI Time Waster
 * based on the number of replies already sent to this thread.
 */
export function determineTimeWasterState(replyCount: number): TimeWasterState {
  if (replyCount <= 0) {
    return 'CONFUSED_CURIOUS';
  }
  if (replyCount === 1) {
    return 'DEEP_PROBING';
  }
  return 'HESITANT_CLOSING';
}

/**
 * Returns prompt directives tailored to the specific Time Waster conversational state.
 */
export function getTimeWasterStateDirectives(state: TimeWasterState): string {
  switch (state) {
    case 'CONFUSED_CURIOUS':
      return `【会話フェーズ: ステップ1 (好奇心・無知)】
- 相手の話に軽く興味を示しつつ、全く理解できていない様子で仕組みを質問してください。
- 決してコミット（「やります」「興味あります」等の断言）はせず、無邪気に質問を投げます。
- 例: 「なるほど。具体的にはどういう仕組みなんですか？」「すみません、ネットに疎くてよく分からないのですが、どういう内容なのでしょうか？」`;

    case 'DEEP_PROBING':
      return `【会話フェーズ: ステップ2 (詳細質問・説明要求)】
- 相手の前回の回答を受け止めつつ、さらに細かい疑問や前提条件について深掘り質問をして相手に説明の手間をかけさせてください。
- なぜ自分に連絡してきたのか、リスクはないのか、初心者の自分でも大丈夫なのかを疑問に感じている態度を取ります。
- 例: 「詳しくありがとうございます。ちなみにどうして私に声をかけてくださったんですか？」「それってリスクや損をする可能性はないんでしょうか？」`;

    case 'HESITANT_CLOSING':
      return `【会話フェーズ: ステップ3 (困惑・慎重・手詰まり)】
- 相手の話を聞いたが「やっぱり自分には難しそう」「少し怪しい・不安」と感じて足踏みしている態度を取ります。
- 相手の要求（リンクを開く、電話する、登録するなど）を丁重にかわしつつ、「今は忙しいのでまた落ち着いたら考えます」等のトーンで相手を手詰まりにさせてください。
- 例: 「ご丁寧にありがとうございます。ただ自分には少し難しそうなので、今はやめておきますね。」「説明ありがとうございます。ちょっと理解が追いつかないので、時間ができたときにまた見ますね。」`;
  }
}
