export const GAME_LANG = {
  zh: {
    name: "三消", description: "在限时内完成尽可能多的有效消除。",
    rules: "依次选择两个相邻方块；组成三个或更多同色方块即可消除。连锁越深、完成越早，得分越高。",
    instructionsTitle: "规则与操作",
    operationSelect: "点击一个方块将它选中。",
    operationSwap: "再点击相邻方块完成交换；不能形成匹配时会自动换回。",
    operationScore: "开局连消也计分；连锁越深、交换时剩余时间越多，得分越高。",
    board: "三消棋盘", tile: "方块", noMoves: "棋盘已无解", timeUp: "时间到", finalScore: "最终成绩",
  },
  en: {
    name: "Match Three", description: "Make as many valid matches as possible before time runs out.",
    rules: "Select two adjacent tiles. Groups of three or more are cleared. Deeper chains and earlier moves score more.",
    instructionsTitle: "Rules & controls",
    operationSelect: "Tap a tile to select it.",
    operationSwap: "Then tap an adjacent tile to swap. A swap that makes no match is reversed.",
    operationScore: "Opening clears also score. Deeper chains and more remaining time award more points.",
    board: "Match three board", tile: "Tile", noMoves: "No moves remain", timeUp: "Time is up", finalScore: "Final score",
  },
};
