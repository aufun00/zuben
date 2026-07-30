export const GAME_LANG = {
  zh: {
    name: "三消", description: "在限时内完成尽可能多的有效消除。",
    rules: "依次选择两个相邻方块；组成三个或更多同色方块即可消除。每多消除一格，本层基础分翻倍；不含新补方块的连锁奖励更高。",
    instructionsTitle: "规则与操作",
    operationSelect: "点击一个方块将它选中。",
    operationSwap: "再点击相邻方块，或向合法方向滑过阈值立即交换；不能形成匹配时会自动换回。",
    operationScore: "开局连消也计分；普通连锁按层数加成，完全由交换前方块形成的连锁再获10倍奖励。",
    board: "三消棋盘", tile: "方块", noMoves: "棋盘已无解", timeUp: "时间到", finalScore: "最终成绩",
    resultReasons: { no_moves: "棋盘已无解", deadline: "时间到" },
  },
  en: {
    name: "Match Three", description: "Make as many valid matches as possible before time runs out.",
    rules: "Select two adjacent tiles. Groups of three or more are cleared. Each extra tile doubles that layer's base score; chains without newly filled tiles score more.",
    instructionsTitle: "Rules & controls",
    operationSelect: "Tap a tile to select it.",
    operationSwap: "Then tap an adjacent tile, or cross the swipe threshold in a legal direction to swap immediately. A swap that makes no match is reversed.",
    operationScore: "Opening clears also score. Regular chains scale by depth; chains made entirely from pre-swap tiles earn a further 10x bonus.",
    board: "Match three board", tile: "Tile", noMoves: "No moves remain", timeUp: "Time is up", finalScore: "Final score",
    resultReasons: { no_moves: "No moves remain", deadline: "Time is up" },
  },
};
