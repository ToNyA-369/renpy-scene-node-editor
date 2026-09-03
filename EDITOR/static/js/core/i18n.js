"use strict";

(function exposeI18n(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SceneI18n = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SUPPORTED_LOCALES = Object.freeze(["zh-Hant", "en"]);
  const DEFAULT_LOCALE = "zh-Hant";
  let currentLocale = DEFAULT_LOCALE;

  const EN_DICTIONARY = Object.freeze({
    "固定值": "Constant",
    "簡單運算": "Calculation",
    "數值來源": "value source",
    "左運算元": "Left operand",
    "右運算元": "Right operand",
    "算術運算子": "Arithmetic operator",
    "比較左值": "Comparison left value",
    "比較右值": "Comparison right value",
    "找不到 Stat": "Missing Stat",
    // Navigation, Header & General UI
    "搜尋節點": "Search nodes",
    "新增節點": "Add Node",
    "Scene Node 列表": "Scene Node List",
    "讀取專案中": "Loading project...",
    "0 個節點": "0 nodes",
    "{count} 個節點": "{count} nodes",
    "重新掃描專案": "Rescan Project",
    "編輯器設定": "Editor Settings",
    "尚未選擇節點": "No node selected",
    "切換節點列表": "Toggle Node List",
    "已同步": "Synced",
    "儲存中...": "Saving...",
    "已儲存": "Saved",
    "儲存失敗": "Save failed",
    "返回上一步": "Undo Last Change",
    "刪除目前功能項目": "Delete Current Item",
    "目前沒有可刪除的項目": "There is no current item to delete",
    "返回上一步中...": "Undoing...",
    "已返回上一步": "Previous change undone",
    "返回上一步失敗": "Undo failed",
    "建立失敗": "Create failed",
    "刪除失敗": "Delete failed",
    "Event 未能儲存": "Event could not be saved",
    "有未儲存的變更": "Unsaved changes",
    "編輯器分頁": "Editor Tabs",
    "節點": "Node",
    "事件": "Events",
    "選項": "Options",
    "演出": "Content",
    "狀態": "State",
    "關聯圖": "Graph",
    "檢查": "Validation",

    // Common Actions & Labels
    "建立第一個 Scene Node": "Create your first Scene Node",
    "關閉": "Close",
    "取消": "Cancel",
    "建立": "Create",
    "建立節點": "Create Node",
    "完成": "Done",
    "刪除": "Delete",
    "重設": "Reset",
    "恢復預設": "Reset to Default",
    "請選擇...": "Select...",
    "無": "None",
    "(無)": "(None)",
    "沒有可選項": "No options available",
    "尚未選擇": "Not selected",
    "選擇項目": "Select item",
    "未設定": "Not set",
    "精確值": "Exact Value",
    "顏色": "Color",
    "不透明度": "Opacity",
    "顯示效果": "Display Effects",
    "背景": "Background",
    "文字": "Text",
    "一般": "Normal",
    "字體大小": "Font Size",
    "文字對齊": "Text Align",
    "靠左": "Left",
    "置中": "Center",
    "靠右": "Right",
    "使用獨立樣式": "Use Item Style Override",
    "只讓不透明部分可點擊": "Alpha Hit Test Only",
    "保持長寬比": "Keep Aspect Ratio",
    "版面細節": "Layout Details",
    "外觀": "Appearance",
    "圖層順序": "Z Order",
    "寬度": "Width",
    "高度": "Height",
    "容器": "Container",
    "Hover 效果": "Hover Effect",
    "Hover 顏色": "Hover Color",
    "Hover 圖片": "Hover Image",
    "Hover Sound": "Hover Sound",
    "Click Sound": "Click Sound",
    "Idle 圖片": "Idle Image",
    "選擇 Idle 圖片": "Select an Idle image",
    "新增選項": "Add Option",
    "拖曳切換表單與畫布": "Drag to toggle Form / Canvas",
    "拖曳切換表單與畫布；也可按 Enter 或方向鍵": "Drag to toggle Form / Canvas (or press Enter / arrow keys)",
    "畫布設定": "Canvas Settings",
    "格線": "Grid",
    "吸附": "Snap",
    "預覽底圖": "Preview Background",
    "畫布上尚無可調整的選項": "No options available to adjust on canvas",
    "選擇或新增選項": "Select or add an option",
    "向左拖曳分隔把手即可回到表單新增。": "Drag the separator handle left to return to form mode and add options.",
    "內容超出時顯示滑桿": "Show scrollbar when content overflows",
    "外觀設定檔": "Appearance Profiles",
    "新增設定檔": "Add Profile",
    "刪除設定檔": "Delete Profile",
    "儲存設定檔": "Save Profile",
    "管理設定檔": "Manage Profiles",
    "不使用設定檔": "No Profile",
    "尚未建立設定檔": "No profiles created",
    "建立第一個外觀設定檔": "Create your first appearance profile",
    "新設定檔": "New Profile",
    "基礎樣式": "Base Style",
    "可選特性": "Optional Features",
    "容器背景": "Container Background",
    "Item 背景": "Item Background",
    "文字顏色": "Text Color",
    "懸停強調條": "Hover Accent",
    "懸停文字色": "Hover Text Color",
    "Item 邊框": "Item Border",
    "文字陰影": "Text Shadow",
    "文字描邊": "Text Outline",
    "Item 圓角": "Item Corners",
    "文字左右內距": "Text Padding",
    "粗體文字": "Bold Text",
    "斜體文字": "Italic Text",
    "文字字距": "Text Spacing",
    "圓角半徑": "Corner Radius",
    "左右內距": "Horizontal Padding",
    "字距": "Letter Spacing",
    "逐項進場": "Staggered Entrance",
    "大小": "Size",
    "移動距離": "Travel Distance",
    "項目延遲": "Item Delay",
    "動畫時間": "Animation Duration",
    "清除個別覆寫": "Clear Local Overrides",
    "{count} 項個別設定正在覆蓋設定檔": "{count} local overrides are taking precedence over this profile",
    "改用設定檔外觀": "Use Profile Appearance",
    "Textbox 外觀": "Textbox Appearance",
    "目前外觀": "Current Appearance",
    "自訂外觀": "Custom Appearance",
    "{count} 個效果已啟用": "{count} effects enabled",
    "{count} 項個別覆寫": "{count} local overrides",
    "設計外觀": "Design Appearance",
    "共用設定": "Shared Settings",
    "選擇外觀設定檔": "Choose an Appearance Profile",
    "正在跟隨": "Following",
    "色彩與文字": "Color & Typography",
    "互動回饋": "Interaction Feedback",
    "效果與 Hover": "Effects & Hover",
    "已啟用": "Enabled",
    "未啟用": "Disabled",
    "先選擇外觀設定檔": "Choose an appearance profile first",
    "可選效果由共用設定檔提供。": "Optional effects are supplied by a shared profile.",
    "單一選項": "Individual Option",
    "尚未選擇 Item": "No Item Selected",
    "先在畫布上選擇一個 Textbox Item。": "Select a Textbox Item on the canvas first.",
    "Textbox 外觀分類": "Textbox Appearance Categories",
    "設定檔": "Profile",
    "樣式": "Style",
    "效果": "Effects",
    "佈局": "Layout",
    "位置與尺寸": "Position & Size",
    "清單": "List",
    "色彩": "Colors",
    "排版": "Typography",
    "目前 Item": "Current Item",
    "目前跟隨 Textbox 的共用樣式。": "Currently following the shared Textbox style.",
    "圖片佈局": "Image Layout",
    "畫布元素": "Canvas Element",
    "調整分類": "Inspector Categories",
    "編輯器顯示": "Editor Display",
    "{count} 個已啟用": "{count} enabled",
    "設定檔已儲存": "Profile saved",
    "設定檔已刪除": "Profile deleted",
    "確定刪除設定檔「{name}」？": "Delete profile “{name}”?",

    // Dialogs & Settings
    "新增 Scene Node": "Add Scene Node",
    "節點名稱": "Node Name",
    "請輸入節點顯示名稱": "Enter node display name",
    "新增 Content": "Add Content",
    "檔名與 Label": "Filename & Label",
    "顯示與語言": "Display & Language",
    "介面語言": "Interface Language",
    "選擇編輯器顯示語言": "Select editor interface language",
    "儲存與畫布": "Save & Canvas",
    "自動儲存": "Autosave",
    "停止輸入後自動寫入專案": "Auto-write to project after typing stops",
    "儲存延遲": "Autosave Delay",
    "連續輸入時等待多久再儲存": "Wait time before saving continuous edits",
    "0.4 秒": "0.4s",
    "0.7 秒": "0.7s",
    "1.2 秒": "1.2s",
    "2 秒": "2s",
    "格線尺寸": "Grid Size",
    "選項畫布的吸附間距": "Snap spacing on option canvas",
    "快捷鍵": "Shortcuts",

    // Shortcuts Descriptions
    "立即儲存": "Save Immediately",
    "新增目前功能項目": "Add Current Item",
    "上一個功能區": "Previous Workspace",
    "下一個功能區": "Next Workspace",
    "展開或收合左側欄位": "Toggle Left Panel",
    "展開或收合右側欄位": "Toggle Right Panel",
    "前往節點": "Go to Node",
    "前往事件": "Go to Events",
    "前往選項": "Go to Options",
    "前往演出": "Go to Content",
    "前往狀態": "Go to Stats",
    "前往關聯圖": "Go to Graph",
    "前往檢查": "Go to Validation",
    "顯示或隱藏格線": "Toggle Grid",
    "開啟或關閉吸附": "Toggle Snap",
    "展開或收合區塊": "Toggle Sections",
    "開啟編輯器設定": "Open Settings",
    "拖曳或按鍵切換表單與畫布": "Drag or key press to toggle Form / Canvas",

    // Node Workspace
    "基本資料": "Basic Info",
    "節點 ID": "Node ID",
    "儲存路徑": "Storage Path",
    "預設起點": "Default Root",
    "目前是專案起點節點": "Currently the root node",
    "設定為起點節點": "Set as root node",
    "ID 為底層系統識別用，不可修改": "ID is used for core system identification and cannot be modified",
    "資料夾相對路徑": "Folder relative path",
    "刪除與回收": "Delete & Trash",
    "刪除節點": "Delete Node",
    "刪除前會先備份至 .scene-node-trash/ 亦可還原": "Backed up to .scene-node-trash/ before deletion; can be restored",
    "可復原節點": "Recoverable Nodes",
    "還原": "Restore",
    "GLOBAL NODE 作用域": "GLOBAL NODE Scope",
    "提供跨 Scene Node 的常駐 Options、Option Trigger Event 與 Option Effect。": "Provides persistent Options, Option Trigger Events, and Option Effects across Scene Nodes.",
    "此作用域固定存在，不進入 Stack，不能設定為 Root Node，也不能刪除。": "This scope is permanent, does not enter the Stack, cannot be set as Root Node, and cannot be deleted.",
    "Global Node 不可刪除。": "Global Node cannot be deleted.",
    "Global Node 不可設為起始節點。": "Global Node cannot be set as root node.",
    "節點設定已儲存": "Node settings saved",

    // Events Workspace
    "Event 清單": "Event List",
    "新增 Event": "Add Event",
    "新增 Event 群組": "Add Event Group",
    "新增群組": "Add Group",
    "在群組中新增 Event": "Add Event to Group",
    "重新命名 Event 群組": "Rename Event Group",
    "重新命名群組": "Rename Group",
    "刪除群組": "Delete Group",
    "群組": "Group",
    "群組名稱": "Group Name",
    "輸入 Event 群組名稱": "Enter Event group name",
    "拖移 Event 到這個群組": "Drop Event into this group",
    "Event 群組未變更": "Event group unchanged",
    "Event 群組已更新": "Event group updated",
    "Event 已移至「{group}」": "Event moved to “{group}”",
    "刪除群組「{group}」並將其中 Events 移至 Normal？": "Delete “{group}” and move its Events to Normal?",
    "Event 群組「{group}」已存在": "Event group “{group}” already exists",
    "新群組": "New Group",
    "群組已建立": "Group created",
    "Event 排序已更新": "Event order updated",
    "拖到這裡以移出群組": "Drop here to remove from group",
    "刪除 Event": "Delete Event",
    "目前沒有 Event": "No Events yet",
    "觸發條件": "Trigger",
    "觸發來源": "Trigger Source",
    "優先度與權重": "Priority & Weight",
    "優先度": "Priority",
    "0 與 1 為系統保留": "0 and 1 are system reserved",
    "權重": "Weight",
    "僅一次 (Once)": "Once only",
    "判斷條件": "Conditions",
    "效果與流程": "Effects & Flow",
    "執行效果": "Effects",
    "演出 Content": "Content",
    "結束流向": "End Up",
    "下個節點": "Next Node",
    "單一節點": "Single Node",
    "權重抽選": "Weighted Choice",
    "新增條件": "Add Condition",
    "新增效果": "Add Effect",
    "不播放 Content": "No Content",
    "選擇 Label...": "Select Label...",
    "全域 Event 僅作用於 __global__ 選項": "Global Events only target __global__ options",
    "全域 Event End Up 作用於當前 Stack 頂端": "Global Event End Up applies to the top of current Stack",
    "左鍵": "Left Click",
    "中鍵": "Middle Click",
    "右鍵": "Right Click",
    "滾輪向上": "Wheel Up",
    "滾輪向下": "Wheel Down",
    "按下鍵盤按鍵": "Press key",
    "沒有條件，這個 Event 會作為無條件候選。": "No conditions; this Event will serve as an unconditional candidate.",
    "全部符合": "All must match",
    "條件類型": "Condition type",
    "記憶庫": "Memory bank",
    "記憶標籤": "Memory tag",
    "尚未註冊 Memory Tag": "No Memory Tags registered",
    "標籤": "Tag",
    "判斷": "Operator",
    "Stat": "Stat",
    "值": "Value",
    "移除條件": "Remove condition",
    "尚未設定 Effect。": "No Effects configured.",
    "效果類型": "Effect type",
    "Option 目標": "Option target",
    "操作": "Operation",
    "移除 Effect": "Remove Effect",
    "清空整個記憶庫": "Clear whole bank",
    "判斷整個記憶庫": "Check whole bank",
    "尚未加入權重項目。": "No weighted items added.",
    "移除項目": "Remove item",

    // Conditions and Effects
    "隨機擇一": "Random choice",
    "機率": "Chance",
    "拖移以排序整個群組": "Drag to reorder the whole group",
    "Stat 數值": "Stat Value",
    "Memory 標籤": "Memory Tag",
    "等於 (=)": "Equals (=)",
    "不等於 (!=)": "Not Equals (!=)",
    "大於 (>)": "Greater Than (>)",
    "大於等於 (>=)": "Greater Than or Equal (>=)",
    "小於 (<)": "Less Than (<)",
    "小於等於 (<=)": "Less Than or Equal (<=)",
    "包含 (has)": "Has Tag (has)",
    "不包含 (not has)": "Does Not Have Tag (not has)",
    "設定 (=)": "Set (=)",
    "增加 (+)": "Add (+)",
    "減少 (-)": "Subtract (-)",
    "新增標籤 (add)": "Add Tag (add)",
    "移除標籤 (remove)": "Remove Tag (remove)",
    "清空庫 (clear)": "Clear Bank (clear)",
    "Option 可用性": "Option Availability",
    "開啟 (enable)": "Enable",
    "關閉 (disable)": "Disable",
    "Element": "Element",
    "新標籤": "new_tag",

    // Options Workspace
    "表單模式": "Form Mode",
    "畫布模式": "Canvas Mode",
    "新增第一個 Option Element": "Add your first Option Element",
    "常駐可用": "Always",
    "受控開啟/關閉": "Controlled",
    "可用性": "Availability",
    "Item 高度": "Item Height",
    "Item 間距": "Item Spacing",
    "間距": "Spacing",
    "Padding": "Padding",
    "最多顯示": "Max Visible",
    "最多可見": "Max Visible",
    "顯示滑桿": "Show Scrollbar",
    "畫布微調": "Canvas Tuning",
    "吸附格線": "Snap to Grid",
    "縮放": "Zoom",
    "刪除 Element": "Delete Element",
    "刪除 Item": "Delete Item",
    "刪除選項": "Delete option",
    "上移": "Move up",
    "下移": "Move down",
    "尚未建立選項": "No options created",
    "{count} 項": "{count} item(s)",
    "尚未建立 Item": "No items created",
    "選擇 Idle 圖片": "Select Idle image",

    // Content Workspace
    "Content 文件": "Content Files",
    "選擇或新增 Content 文件": "Select or add a Content file",
    "選擇或新增 Content 文件。": "Select or add a Content file.",
    "Label 編輯": "Label Editor",
    "刪除文件": "Delete File",
    "刪除演出": "Delete Content",
    "儲存演出": "Save Content",
    "Ren'Py Label 原始碼": "Ren'Py Label Source Code",
    "按下 Cmd+S 或自動儲存": "Press Cmd+S or wait for autosave",
    "尚未建立文件": "No content files created",
    "{count} 個 label": "{count} label(s)",
    "尚未偵測到 label": "No labels detected",
    "Content 名稱": "Content Name",
    "Ren'Py 程式碼編輯器": "Ren'Py code editor",
    "載入語法支援中": "Loading language support",
    "語法支援已啟用": "Language support active",
    "基本編輯模式": "Basic editor mode",

    // Stats Workspace
    "Normal (預設群組)": "Normal (Default Group)",
    "新增群組": "Add Group",
    "新增 Stat": "Add Stat",
    "Memory Banks": "Memory Banks",
    "新增記憶庫": "Add Memory Bank",
    "Stat 名稱": "Stat Name",
    "Min": "Min",
    "Max": "Max",
    "Init": "Init",
    "Bank ID": "Bank ID",
    "顯示名稱": "Display Name",
    "刪除 Stat": "Delete Stat",
    "刪除群組": "Delete Group",
    "刪除記憶庫": "Delete Bank",
    "這個群組尚未建立 Stat。": "No Stats created in this group.",
    "移除 Stat": "Remove Stat",
    "群組名稱": "Group Name",
    "在 {group} 新增 Stat": "Add Stat in {group}",
    "記憶庫名稱": "Bank Name",
    "預設": "Default",
    "移除記憶庫": "Remove Bank",
    "新增 Stat 群組": "Add Stat Group",
    "拖移 Stat": "Drag Stat",
    "拖移群組": "Drag group",
    "Stat 群組已更新": "Stat group updated",
    "Stat 排序已更新": "Stat order updated",
    "新數值": "new_stat",
    "新記憶庫": "new_bank",
    "新圖片選項": "new_picture_option",
    "新互動區域": "new_hitbox_option",

    // Graph Workspace
    "重設視角": "Reset View",
    "縮放 (Fit)": "Fit View",
    "圖例": "Legend",
    "讀取中...": "Loading...",
    "沒有節點": "No Nodes",
    "建立 Scene Node 後，關聯圖會顯示 GOTO／REPLACE 關係。": "After creating a Scene Node, graph will show GOTO / REPLACE relationships.",
    "REPLACE 管理關係": "REPLACE management relationship",
    "開啟節點 {name}": "Open node {name}",
    "未連結至 ROOT 的節點": "Nodes detached from ROOT",
    "搜尋關聯圖節點": "Search graph nodes",
    "顯示全圖": "Show full graph",
    "依 Stack 深度排列的 Scene Node GOTO 與 REPLACE 有向關聯圖": "Directed graph of Scene Node GOTO and REPLACE by Stack depth",

    // Validation Workspace
    "專案檢查": "Project Validation",
    "重新檢查": "Re-check",
    "0 個問題": "0 issues",
    "{count} 個問題": "{count} issues",
    "全部正常": "All clear",
    "錯誤": "Error",
    "警告": "Warning",
    "提醒": "Warning",
    "未發現專案問題": "No project issues found",
    "目前沒有發現格式或引用問題。": "No formatting or reference issues found.",
    "{errors} 個錯誤，{warnings} 個提醒。": "{errors} error(s), {warnings} warning(s).",
    "找到 {count} 個項目": "Found {count} issue(s)",
    "專案檢查通過": "Project validation passed",

    // Toasts, Prompts, Confirms and Error / Success Messages
    "快捷鍵已用於「{action}」": "Shortcut already bound to \"{action}\"",
    "已切換為起點節點": "Set as root node",
    "{name} 已設為起始節點": "{name} set as root node",
    "已復原節點：{id}": "Restored node: {id}",
    "節點已移至回收區：{id}": "Node moved to trash: {id}",
    "節點已移至可復原區：{id}": "Node moved to trash: {id}",
    "文件已建立": "File created",
    "Content 文件已刪除": "Content file deleted",
    "Event 已刪除": "Event deleted",
    "已重設快捷鍵": "Shortcuts reset",
    "編輯器設定未能儲存": "Failed to save editor settings",
    "編輯器設定未能儲存：{message}": "Failed to save editor settings: {message}",
    "自動儲存失敗：{message}": "Autosave failed: {message}",
    "刪除失敗：{message}": "Delete failed: {message}",
    "建立失敗：{message}": "Create failed: {message}",
    "儲存失敗：{message}": "Save failed: {message}",
    "建立中...": "Creating...",
    "刪除中...": "Deleting...",
    "Scene Node 已建立": "Scene Node created",
    "Event 已儲存": "Event saved",
    "Options.json 已儲存": "Options.json saved",
    "Content 已儲存": "Content saved",
    "Content 已刪除": "Content deleted",
    "狀態定義已儲存": "Stats & Memories saved",
    "請先建立或選擇節點": "Please create or select a node first",
    "選項具有多種元件類型，請在表單模式使用左側新增按鈕": "Options have multiple element types; please use the left add buttons in form mode",
    "狀態具有 Stats 與 Memory，請使用各區新增按鈕": "State contains Stats and Memory; please use the add buttons in each section",
    "目前功能區沒有可新增的項目": "Current workspace has no addable items",
    "{label}：{message}": "{label}: {message}",
    "無法刪除「{name}」：仍被 {count} 個 Event Effect 引用。": "Cannot delete \"{name}\": still referenced by {count} Event Effect(s).",
    "確定刪除「{name}」？": "Are you sure you want to delete \"{name}\"?",
    "確定刪除「{name}」？\n\n{events} 個 Event、{contents} 個 Content 將移至可復原區。": "Are you sure you want to delete \"{name}\"?\n\n{events} Event(s) and {contents} Content file(s) will be moved to trash.",
    "確定刪除 Event「{id}」？": "Are you sure you want to delete Event \"{id}\"?",
    "確定刪除 Content「{name}」？": "Are you sure you want to delete Content \"{name}\"?",
    "目前仍有 {count} 個 Event 指向「{name}」：\n\n{lines}\n\n請先修改這些 Next Node。": "There are still {count} Event(s) pointing to \"{name}\":\n\n{lines}\n\nPlease update their Next Node first.",
    "目前專案沒有任何 Stat。請先到「狀態」建立 Stat，再新增 Stat {kind}。": "Project has no Stats. Please create a Stat under \"State\" first before adding a Stat {kind}.",
    "目前作用域沒有 CONTROLLED Option。請先在「選項」把 Element 或 Item 的 Availability 設為 CONTROLLED。": "Current scope has no CONTROLLED Option. Please set an Element or Item Availability to CONTROLLED in \"Options\" first.",
    "目前節點沒有可用的 Content label。": "Current node has no available Content label.",
    "目前專案沒有 Scene Node。": "Project has no Scene Nodes.",
    "目前節點尚未建立可供 Event 使用的選項。": "Current node has no options created for Events.",
    "選項設定未能儲存": "Failed to save options settings",
    "Content 未能儲存": "Failed to save Content",
    "狀態定義未能儲存": "Failed to save state definitions",
    "無法連線到編輯器伺服器。請保持此頁開啟並重新啟動編輯器。": "Unable to connect to editor server. Please keep this page open and restart the editor.",
    "請求失敗 ({status})": "Request failed ({status})",

    // Server Validation Copy
    "Editor 設定必須是 object。": "Editor settings must be an object.",
    "快捷鍵設定必須是 object。": "Shortcut settings must be an object.",
    "語言設定不合法，僅支援 zh-Hant 與 en。": "Invalid language setting, only zh-Hant and en are supported.",
    "尚未設定 Root Node。": "Root Node is not configured.",
    "找不到 Root Node：{root_node}。": "Root Node not found: {root_node}.",
    "Root Node 尚未連接到 scene_runtime_start()。": "Root Node is not connected to scene_runtime_start().",
    "Global Node ID 必須固定為 {id}。": "Global Node ID must be fixed as {id}.",
    "Scene Node 不可使用保留 ID：{id}。": "Scene Node cannot use reserved ID: {id}.",
    "Node ID {node_id} 重複。": "Duplicate Node ID: {node_id}.",
    "選項 Trigger {trigger} 沒有對應的 Event。": "Option Trigger {trigger} has no corresponding Event.",
    "檔名與 Event ID 不一致。": "Filename does not match Event ID.",
    "找不到 Stat：{id}。": "Stat not found: {id}.",
    "找不到記憶庫：{bank}。": "Memory bank not found: {bank}.",
    "找不到 Option Effect 目標：{target}。": "Option Effect target not found: {target}.",
    "Option Effect 目標必須設為 CONTROLLED：{target}。": "Option Effect target must be set to CONTROLLED: {target}.",
    "找不到 Content label：{label}。": "Content label not found: {label}.",
    "找不到 Next Node：{target}。": "Next Node not found: {target}.",
    "找不到 Content 文件。": "Content file not found.",
    "找不到要刪除的文件。": "File to delete not found.",
    "找不到指定的 Global Node。": "Specified Global Node not found.",
    "找不到指定的 Scene Node。": "Specified Scene Node not found.",
    "找不到指定的 authoring scope。": "Specified authoring scope not found.",
    "這個 ID 或路徑保留給 Global Node。": "This ID or path is reserved for Global Node.",
    "這個 Scene Node路徑已經存在。": "This Scene Node path already exists.",
    "這個 Scene Node 路徑已經存在。": "This Scene Node path already exists.",
    "找不到 API。": "API not found.",
    "請求內容不是有效的 JSON。": "Request body is not valid JSON.",
    "Content-Length 不合法。": "Invalid Content-Length.",
    "名稱不可為空，也不可包含路徑符號。": "Name cannot be empty or contain path separators.",
    "Scene Node 路徑不可為空。": "Scene Node path cannot be empty.",
    "Scene Node 路徑不合法。": "Invalid Scene Node path.",
    "資源路徑不合法。": "Invalid asset path.",
    "Stats 必須是 JSON object。": "Stats must be a JSON object.",
    "Memories 必須是 JSON object。": "Memories must be a JSON object.",
    "{current}（未找到）": "{current} (not found)",
    "{name}（未找到）": "{name} (not found)",
    "（未找到）": " (not found)",
    "沒有 label": "No label",
    "目前節點沒有 Content 文件。": "Current node has no Content files.",
    "{count} 個節點": "{count} node(s)",
    "尚未選擇節點": "No node selected",
    "沒有符合的節點": "No matching nodes",
    "尚未建立 Scene Node": "No Scene Nodes created yet",
    "所有 Scene Node 的事件與選項作用域": "Event & Option scope applied to all Scene Nodes",
    "Global Event 數量": "Global Event count",
    "Event 數量": "Event count",
    "掃描中": "Scanning...",
    "套用至所有 Scene Node 的全域事件與選項作用域": "Global Event & Option scope applied to all Scene Nodes",
    "目前的遊戲起始節點": "Current game root node",
    "可設為遊戲起始節點": "Can be set as game root node",
    "設為起始節點": "Set as Root",
    "請先將其他節點設為起始節點": "Please set another node as Root first",
    "刪除節點": "Delete Node",
    "尚未建立 Event": "No Events created yet",
    "新增 Event": "Add Event",
    "這個節點還沒有 Event。": "This node has no Events yet.",
    "Option 選項": "Option target",
    "Keyboard 按鍵": "Keyboard key",
    "Mouse 按鍵": "Mouse button",
    "Auto 時機": "Auto timing",
    "Trigger 模式": "Trigger mode",
    "聚焦後直接按下按鍵或按鍵組合": "Focus and press any key or key combination",
    "{count} 個條件": "{count} condition(s)",
    "新增條件": "Add Condition",
    "{count} 個效果": "{count} effect(s)",
    "新增 Effect": "Add Effect",
    "{count} 個演出": "{count} content item(s)",
    "新增演出": "Add Content",
    "新增節點": "Add Node",
    "刪除事件": "Delete Event",
    "尚未建立選項": "No options created yet",
    "尚未建立 Item": "No Items created yet",
    "選擇 Idle 圖片": "Select Idle image",
    "{count} 個選項": "{count} option(s)",
    "最多顯示": "Max Visible",
    "Item 高度": "Item Height",
    "Item 間距": "Item Spacing",
    "Padding": "Padding",
    "顯示或隱藏格線（{shortcut}）": "Toggle grid ({shortcut})",
    "開啟或關閉吸附（{shortcut}）": "Toggle snap ({shortcut})",
    "上移": "Move Up",
    "下移": "Move Down",
    "整個選項列": "Entire option bar",
    "新數值": "New Stat",
    "新記憶庫": "New Memory Bank",
    "新標籤": "New Tag",
    "未預期的錯誤：{exc}": "Unexpected error: {exc}",
    "全局": "global",
    "讀取失敗": "Load failed",
    "選項清單": "Option List",
    "填充方式": "Fit Mode",
    "繁體中文": "Traditional Chinese",
  });

  function normalizeLocale(rawLocale) {
    if (!rawLocale || typeof rawLocale !== "string") return DEFAULT_LOCALE;
    const clean = rawLocale.trim().toLowerCase();
    if (clean === "en" || clean.startsWith("en-") || clean.startsWith("en_")) return "en";
    return DEFAULT_LOCALE;
  }

  function getLocale() {
    return currentLocale;
  }

  function setLocale(rawLocale) {
    currentLocale = normalizeLocale(rawLocale);
    return currentLocale;
  }

  function interpolate(text, params) {
    if (!params || typeof params !== "object") return text;
    return String(text).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      if (Object.hasOwn(params, key) && params[key] !== undefined && params[key] !== null) {
        return String(params[key]);
      }
      return match;
    });
  }

  function t(key, params) {
    if (key === null || key === undefined) return "";
    const strKey = String(key);
    let pattern = strKey;

    if (currentLocale === "en") {
      if (Object.hasOwn(EN_DICTIONARY, strKey)) {
        pattern = EN_DICTIONARY[strKey];
      }
    }

    return interpolate(pattern, params);
  }

  function translateDocument(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;

    if (doc.documentElement) {
      doc.documentElement.setAttribute("lang", currentLocale);
    }

    const i18nElements = doc.querySelectorAll("[data-i18n]");
    i18nElements.forEach((el) => {
      let key = el.getAttribute("data-i18n");
      if (!key) {
        if (!el.dataset.i18nKey) {
          el.dataset.i18nKey = el.textContent.trim();
        }
        key = el.dataset.i18nKey;
      }
      el.textContent = t(key);
    });

    const placeholderElements = doc.querySelectorAll("[data-i18n-placeholder]");
    placeholderElements.forEach((el) => {
      let key = el.getAttribute("data-i18n-placeholder");
      if (!key) {
        if (!el.dataset.i18nPlaceholderKey) {
          el.dataset.i18nPlaceholderKey = el.placeholder;
        }
        key = el.dataset.i18nPlaceholderKey;
      }
      el.placeholder = t(key);
    });

    const titleElements = doc.querySelectorAll("[data-i18n-title]");
    titleElements.forEach((el) => {
      let key = el.getAttribute("data-i18n-title");
      if (!key) {
        if (!el.dataset.i18nTitleKey) {
          el.dataset.i18nTitleKey = el.title;
        }
        key = el.dataset.i18nTitleKey;
      }
      el.title = t(key);
    });

    const ariaLabelElements = doc.querySelectorAll("[data-i18n-aria-label]");
    ariaLabelElements.forEach((el) => {
      let key = el.getAttribute("data-i18n-aria-label");
      if (!key) {
        if (!el.dataset.i18nAriaLabelKey) {
          el.dataset.i18nAriaLabelKey = el.getAttribute("aria-label") || "";
        }
        key = el.dataset.i18nAriaLabelKey;
      }
      if (key) {
        el.setAttribute("aria-label", t(key));
      }
    });
  }

  return {
    DEFAULT_LOCALE,
    EN_DICTIONARY,
    SUPPORTED_LOCALES,
    getLocale,
    interpolate,
    normalizeLocale,
    setLocale,
    t,
    translateDocument,
  };
});
