export const DRAWING_REVIEW_RULE_SET_VERSION = "company-v1.1";

export type DrawingReviewRule = {
  code: string;
  category: "尺寸與圖面" | "系統櫃" | "廚房與電器" | "浴室與動線" | "施工與資料";
  title: string;
  appliesWhen: string;
  check: string;
  severity: "fatal" | "warning" | "insufficient";
};

export const drawingReviewRules: DrawingReviewRule[] = [
  { code: "DIMENSION-CHAIN-001", category: "尺寸與圖面", title: "尺寸鏈加總", appliesWhen: "圖面有總尺寸及可辨識的分尺寸", check: "分尺寸加總與總尺寸差值 1–2 mm 列警告；差值超過 2 mm 列明確問題。圖面已註明門縫或取整方式者除外", severity: "fatal" },
  { code: "PLAN-ELEVATION-001", category: "尺寸與圖面", title: "平立剖面尺寸一致", appliesWhen: "同一櫃體或構件出現在平面、立面或剖面", check: "寬、深、高差值 1–2 mm 列警告；超過 2 mm 列明確問題", severity: "fatal" },
  { code: "KEY-DIMENSION-001", category: "尺寸與圖面", title: "關鍵尺寸完整性", appliesWhen: "櫃體、設備、走道或開口需要下料或施工", check: "總寬、總高、深度或定位尺寸缺漏及無法辨識時列人工確認", severity: "insufficient" },
  { code: "PANEL-THICKNESS-001", category: "尺寸與圖面", title: "板厚與收邊納入尺寸鏈", appliesWhen: "圖面有側板、終端板、收邊板、踢腳板或檯面", check: "板厚及收邊不得漏入總尺寸；無法判斷時列人工確認", severity: "warning" },
  { code: "CABINET-TOP-001", category: "尺寸與圖面", title: "到頂櫃與完成淨高", appliesWhen: "櫃體設計到頂或接近天花", check: "櫃體總高不得大於現場完成淨高，並須保留安裝方式所需空間", severity: "fatal" },
  { code: "WOOD-FLOOR-001", category: "尺寸與圖面", title: "木地板扣高", appliesWhen: "空間有木地板且設置落地櫃、到頂櫃或貼地門片", check: "確認櫃高及門片離地已扣除木地板完成厚度", severity: "warning" },
  { code: "REVISION-INFO-001", category: "尺寸與圖面", title: "圖面版本資訊", appliesWhen: "所有施工圖", check: "圖號、頁碼、日期或修訂版本缺漏時列人工確認", severity: "insufficient" },
  { code: "UNIT-SCALE-001", category: "尺寸與圖面", title: "單位與比例資訊", appliesWhen: "圖面需依尺寸或比例施工", check: "單位不明、同份圖混用 cm 與 mm 未說明，或比例資訊不足時列人工確認", severity: "insufficient" },

  { code: "DESK-HEIGHT-001", category: "系統櫃", title: "書桌完成面高度", appliesWhen: "固定式書桌或書桌櫃", check: "不得低於 760 mm", severity: "fatal" },
  { code: "DESK-DEPTH-001", category: "系統櫃", title: "書桌深度", appliesWhen: "固定式書桌或書桌櫃", check: "不得小於 600 mm", severity: "fatal" },
  { code: "DESK-KNEE-HEIGHT-001", category: "系統櫃", title: "書桌腿部淨高", appliesWhen: "書桌下方供使用者坐姿使用", check: "淨高不得小於 650 mm", severity: "warning" },
  { code: "DESK-KNEE-WIDTH-001", category: "系統櫃", title: "書桌腿部淨寬", appliesWhen: "書桌下方供使用者坐姿使用", check: "淨寬不得小於 600 mm", severity: "warning" },
  { code: "WARDROBE-HINGED-001", category: "系統櫃", title: "對開門衣櫃深度", appliesWhen: "平開門或對開門衣櫃", check: "櫃體深度不得小於 600 mm", severity: "fatal" },
  { code: "WARDROBE-SLIDING-001", category: "系統櫃", title: "滑門衣櫃深度", appliesWhen: "橫向滑門衣櫃", check: "櫃體深度不得小於 650 mm", severity: "fatal" },
  { code: "WARDROBE-LONG-HANG-001", category: "系統櫃", title: "長衣區淨高", appliesWhen: "衣櫃標示長衣吊掛區", check: "吊掛淨高不得小於 1500 mm", severity: "warning" },
  { code: "WARDROBE-SHORT-HANG-001", category: "系統櫃", title: "短衣區淨高", appliesWhen: "衣櫃標示短衣吊掛區", check: "吊掛淨高不得小於 1000 mm", severity: "warning" },
  { code: "HANGING-ROD-001", category: "系統櫃", title: "吊衣桿干涉", appliesWhen: "衣櫃內設吊衣桿", check: "吊衣桿、衣架及衣物不得與層板、抽屜、門片或燈具干涉", severity: "warning" },
  { code: "SHOE-CABINET-001", category: "系統櫃", title: "鞋櫃一般深度", appliesWhen: "鞋櫃深度為 350–379 mm", check: "提醒確認斜板、使用者鞋碼及特殊收納方式；380 mm 以上可採一般平放層板", severity: "warning" },
  { code: "SHOE-CABINET-002", category: "系統櫃", title: "鞋櫃深度高風險", appliesWhen: "鞋櫃深度小於 350 mm", check: "列高風險人工確認，須核對斜板、鞋碼、門片及實際可用淨深；不要再重複輸出 SHOE-CABINET-001", severity: "insufficient" },
  { code: "HIGH-CABINET-SHELF-001", category: "系統櫃", title: "高櫃收納層板數", appliesWhen: "落地到頂的純收納高櫃，不含衣櫃、矮櫃、吊櫃、電視櫃及電器格", check: "純收納固定或活動層板至少 5 片；抽屜、拉籃及開放電器格不計", severity: "warning" },
  { code: "SHELF-SPAN-001", category: "系統櫃", title: "層板跨度補強", appliesWhen: "層板淨跨度超過 800 mm", check: "提醒確認板厚、載重及是否加厚、加前緣或設中立板補強", severity: "warning" },
  { code: "HIGH-CABINET-ANTI-TIP-001", category: "系統櫃", title: "高櫃防傾倒", appliesWhen: "落地高櫃或重心偏高櫃體", check: "須確認固定牆面、背板鎖固或其他防傾倒方式", severity: "warning" },
  { code: "DRAWER-INTERFERENCE-001", category: "系統櫃", title: "抽屜與門片干涉", appliesWhen: "抽屜、拉籃或內抽位於門片後方或鄰近牆面", check: "完全拉出時不得撞門片、鉸鍊、把手、牆面或相鄰櫃體", severity: "fatal" },
  { code: "CABINET-OUTLET-001", category: "系統櫃", title: "櫃內插座可使用性", appliesWhen: "櫃內設插座或需供電設備", check: "插座不得被固定層板、背板或設備完全封住，須可插拔及維修", severity: "warning" },
  { code: "MAINTENANCE-ACCESS-001", category: "系統櫃", title: "設備維修空間", appliesWhen: "櫃內有電箱、弱電箱、閥件、清潔口或需維修設備", check: "設備前方不得有不可拆層板或門片阻擋，須保留開啟及維修空間", severity: "warning" },
  { code: "DOOR-SWING-001", category: "系統櫃", title: "櫃門開啟干涉", appliesWhen: "平開櫃門靠近牆面、房門或其他櫃體", check: "門片開啟不得碰撞牆面、把手、房門、窗簾或相鄰櫃體", severity: "fatal" },

  { code: "APPLIANCE-MODEL-001", category: "廚房與電器", title: "電器型號與規格", appliesWhen: "有嵌入式或櫃內電器", check: "未提供型號、原廠外觀尺寸或安裝尺寸時列人工確認，不自行假設原廠需求", severity: "insufficient" },
  { code: "APPLIANCE-OPENING-001", category: "廚房與電器", title: "電器安裝開口", appliesWhen: "已提供電器型號或尺寸", check: "櫃體安裝開口不得小於原廠要求，且須保留安裝與拆卸空間", severity: "fatal" },
  { code: "APPLIANCE-VENTILATION-001", category: "廚房與電器", title: "電器散熱", appliesWhen: "冰箱、烤箱、蒸烤箱、洗碗機或其他發熱設備入櫃", check: "依原廠規格核對左右、上方、後方與進排氣空間；缺原廠規格時列人工確認", severity: "insufficient" },
  { code: "REFRIGERATOR-DOOR-001", category: "廚房與電器", title: "冰箱門開啟", appliesWhen: "冰箱靠牆、側板或高櫃", check: "確認門片可開至取出抽屜及層板所需角度，且把手不碰牆或櫃體", severity: "warning" },
  { code: "DISHWASHER-CLEARANCE-001", category: "廚房與電器", title: "洗碗機開門干涉", appliesWhen: "設置洗碗機", check: "機門完全打開時不得撞踢腳板、把手、側板、對面櫃體或影響主要動線", severity: "fatal" },
  { code: "APPLIANCE-OUTLET-001", category: "廚房與電器", title: "電器插座位置", appliesWhen: "固定或嵌入式電器需要插座", check: "插座不得位於機體無法插拔或維修的位置，並須避免電源線被壓折", severity: "warning" },
  { code: "APPLIANCE-VOLTAGE-001", category: "廚房與電器", title: "設備電壓一致", appliesWhen: "圖面同時標示設備與 110V、220V 或專用迴路", check: "圖面電壓與設備原廠需求不一致時列明確問題；缺設備規格時列人工確認", severity: "fatal" },
  { code: "SINK-ELECTRICAL-001", category: "廚房與電器", title: "給排水與用電干涉", appliesWhen: "水槽、淨水器、洗碗機或廚下設備附近有插座及管線", check: "插座、電源供應器、給排水、濾芯及垃圾處理器不得互相占用維修空間或形成明顯碰撞", severity: "warning" },
  { code: "COUNTER-HEIGHT-001", category: "廚房與電器", title: "流理台完成高度", appliesWhen: "廚房流理台或固定工作檯", check: "完成高度建議 850–900 mm，超出時提醒確認使用者身高與設備需求", severity: "warning" },
  { code: "UPPER-CABINET-GAP-001", category: "廚房與電器", title: "吊櫃與檯面間距", appliesWhen: "檯面上方設吊櫃", check: "吊櫃底至檯面建議 600–700 mm，超出時提醒確認使用性、設備高度及排煙需求", severity: "warning" },
  { code: "KITCHEN-AISLE-001", category: "廚房與電器", title: "廚房及中島走道", appliesWhen: "廚具、中島或對向櫃體形成操作走道", check: "淨寬小於 900 mm 列警告；雙人操作建議 1100 mm，未達 1100 mm 僅提醒不判定明確問題", severity: "warning" },
  { code: "ROBOT-VACUUM-001", category: "廚房與電器", title: "掃地機器人櫃", appliesWhen: "設置掃地機器人櫃或回充位置", check: "確認插座、前方淨空、機器尺寸、回充對位及 Wi-Fi；自清洗機型另確認給排水", severity: "insufficient" },

  { code: "SHOWER-SIZE-001", category: "浴室與動線", title: "淋浴區內部尺寸", appliesWhen: "住宅一般淋浴區，非專案無障礙法規檢核", check: "完成面內部不得小於 800 × 800 mm", severity: "warning" },
  { code: "BATHROOM-DOOR-001", category: "浴室與動線", title: "浴室門淨寬", appliesWhen: "住宅一般浴室，非專案無障礙法規檢核", check: "淨寬小於 700 mm 時列警告；門片不得碰撞馬桶、浴櫃或淋浴門", severity: "warning" },
  { code: "TOILET-CLEARANCE-001", category: "浴室與動線", title: "馬桶使用及維修空間", appliesWhen: "圖面可辨識馬桶、牆面與鄰近設備", check: "確認左右、前方、進出及水箱維修空間；尺寸不足或無法量測時列人工確認", severity: "insufficient" },
  { code: "VANITY-PLUMBING-001", category: "浴室與動線", title: "浴櫃抽屜與排水", appliesWhen: "浴櫃內設抽屜且有給排水", check: "抽屜及滑軌不得撞排水管、給水管、角閥或落水頭", severity: "fatal" },
  { code: "WALKWAY-001", category: "浴室與動線", title: "一般單人走道", appliesWhen: "住宅一般室內單人動線，非專案無障礙法規檢核", check: "完成面淨寬小於 750 mm 列警告；750–899 mm 可使用但提醒舒適性，900 mm 以上通過", severity: "warning" },
  { code: "BED-AISLE-001", category: "浴室與動線", title: "床側走道", appliesWhen: "床側需供人通行或上下床", check: "完成面淨寬小於 450 mm 列警告", severity: "warning" },
  { code: "CEILING-HEIGHT-001", category: "浴室與動線", title: "居室完成淨高", appliesWhen: "住宅一般居室且圖面可辨識完成天花高度", check: "低於 2400 mm 時提醒確認設計需求及專案適用法規", severity: "warning" },
  { code: "DOOR-CLEARANCE-001", category: "浴室與動線", title: "房門與家具干涉", appliesWhen: "房門附近有櫃體、床、桌或其他門片", check: "門扇開啟範圍不得碰撞固定家具、櫃門或阻斷主要通行空間", severity: "fatal" },

  { code: "CURTAIN-BOX-001", category: "施工與資料", title: "窗簾盒與電動窗簾", appliesWhen: "圖面有窗簾盒、雙層簾或電動窗簾", check: "確認盒內淨寬、軌道固定、載重、電源與檢修方式；缺資料時列人工確認", severity: "insufficient" },
  { code: "TV-CABLE-001", category: "施工與資料", title: "電視牆藏線通道", appliesWhen: "圖面有壁掛電視與下方電視櫃", check: "未見壁掛位置至電視櫃的連通管或藏線通道標示時，提醒人工確認，不直接判定沒有施作", severity: "warning" },
  { code: "TV-BACKING-001", category: "施工與資料", title: "壁掛電視承重打底", appliesWhen: "圖面標示壁掛電視", check: "確認牆體承重、固定打底、壁掛架位置及檢修方式", severity: "warning" },
  { code: "ELECTRICAL-PANEL-001", category: "施工與資料", title: "電箱與弱電箱維修", appliesWhen: "電箱或弱電箱被櫃體包覆", check: "須標示箱體定位、背板開孔、門蓋開啟及前方維修淨空；缺漏時列人工確認", severity: "insufficient" },
  { code: "PLUMBING-ACCESS-001", category: "施工與資料", title: "給排水維修口", appliesWhen: "管線、存水彎、閥件或清潔口被櫃體包覆", check: "須保留可拆背板、活動層板或維修口，不得永久封死", severity: "warning" },
  { code: "MOISTURE-VENTILATION-001", category: "施工與資料", title: "潮濕櫃體通風", appliesWhen: "浴櫃、鞋櫃、洗衣櫃或其他高濕度櫃體", check: "提醒確認耐潮材料、通風、離地、防水收邊及漏水檢修方式", severity: "warning" },
  { code: "MATERIAL-SPEC-001", category: "施工與資料", title: "材料與五金規格", appliesWhen: "圖面需下料、採購或安裝", check: "板材厚度、材質、門片、五金或設備規格缺漏且影響施工時列人工確認", severity: "insufficient" },
  { code: "SWITCH-ACCESS-001", category: "施工與資料", title: "開關插座可及性", appliesWhen: "開關、插座靠近櫃體、門片、床頭或固定設備", check: "不得被門片、櫃體或設備遮擋，並須可正常操作與維修", severity: "warning" }
];
