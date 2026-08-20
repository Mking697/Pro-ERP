import { MODULE_ACCESS_KEYS, type ModuleAccessKey } from "@/lib/moduleAccess";

/**
 * The in-app guidebook, as data rather than a page of prose.
 *
 * Every section declares who it is for, so one body of content serves everybody without
 * anyone reading instructions for buttons they do not have. A doer who can only complete
 * their own tasks should not have to scroll past sheet-connection steps to find out how
 * their score is calculated; an Admin setting the system up for the first time should
 * find those steps without hunting.
 */
export type Audience =
  | "everyone"
  /** Organization Admin — manages users and connections. */
  | "admin"
  /** Platform operator — runs this install for all organizations. */
  | "platform"
  | ModuleAccessKey;

export interface GuideSection {
  id: string;
  title: string;
  audience: Audience;
  summary: string;
  /**
   * How the thing actually works, in plain words.
   *
   * Separate from `steps` because knowing which buttons to press is not the same as
   * understanding what the system is doing — and in inventory the second one is what
   * stops people from mistrusting a number they cannot explain.
   */
  how?: string[];
  /** Ordered instructions, when the section is something you *do*. */
  steps?: string[];
  /** A worked example. Numbers teach a calculation faster than any paragraph. */
  example?: {
    title: string;
    /** Rendered as a monospace block — keep lines short and aligned. */
    lines: string[];
  };
  /** Things that bite people, stated where they will be read. */
  notes?: string[];
}

export interface GuideChapter {
  id: string;
  title: string;
  description: string;
  sections: GuideSection[];
}

export const GUIDE: GuideChapter[] = [
  {
    id: "basics",
    title: "Shuruaat",
    description: "Har user ke liye — chahe koi bhi role ho.",
    sections: [
      {
        id: "what-is",
        title: "Pro ERP kya hai",
        audience: "everyone",
        summary:
          "Ye aapke organization ka kaam-kaaj sambhalne wala system hai — task delegation, recurring kaam, material inward aur quality check, inventory aur stock, product ki BOM, production planning, aur sabki performance scoring. Saara data aapke organization ke apne Google Sheets me rehta hai; Pro ERP usi ko padhta-likhta hai.",
        how: [
          "Poore system me ek soch baar-baar dikhegi: koi bhi ginti wala number kahin store karke nahi rakha jaata — wo hamesha asli entries se jod kar nikala jaata hai.",
          "Aapka MIS score kisi khaane me likha nahi hai; wo aapke tasks ke waqt se banta hai. Kisi item ka stock bhi kahin likha nahi hai; wo har In aur Out ka jod hai.",
          "Isse do faayde hain. Ek, koi number kabhi purana nahi padta — koi background job atak jaaye to bhi galat number nahi dikhega. Do, har number ka jawab maujood rehta hai — 'ye aankda aaya kahan se' ka answer hamesha nikala ja sakta hai.",
        ],
        notes: [
          "Aapko jo modules dikhte hain wo aapke Admin ne aapko diye hain. Kisi doosre organization ka data aapko kabhi nahi dikhega.",
          "Naya module milne par ek baar logout karke dobara login karein — aapke access ka faisla login ke waqt hota hai.",
        ],
      },
      {
        id: "login",
        title: "Login aur password",
        audience: "everyone",
        summary: "Apne email aur password se login karein.",
        steps: [
          "Login page par apna email aur password daalein.",
          "Password type karte waqt aankh wale button se use dekh sakte hain — galat type hone se bachne ke liye.",
        ],
        notes: [
          "Password bhool jaayein to sheet me dhoondhne ki koshish na karein — wahan sirf uska encrypted hash hota hai, jisse login nahi hota. Apne Admin se reset karwayein.",
          "Password copy-paste karte waqt aakhir me extra space aa jaana aam galti hai — us se login fail hota hai.",
        ],
      },
      {
        id: "charts",
        title: "Dashboard tab ke charts",
        audience: "everyone",
        summary:
          "Dashboard tab me aapke har module ka apna chart hai — jo access aapke paas hai, sirf uske.",
        notes: [
          "Upar ke buttons se period badlein: Aaj, Is hafte, Is mahine, Is saal, Sab — ya From/To se apni date range.",
          "Har chart me rang ke saath ginti bhi likhi hoti hai, isliye rang na dikhe tab bhi sab padha ja sakta hai.",
          "Kisi bhi bar ya slice par maus le jaane se uski poori value dikhti hai.",
        ],
      },
      {
        id: "dashboard",
        title: "Apna dashboard padhna",
        audience: "everyone",
        summary:
          "Upar teen cards hain — Pending Tasks, Completed Tasks, aur aapka MIS Score. Uske neeche tabs hain jo aapke access ke hisaab se dikhte hain.",
        notes: [
          "Overview tab me aapke modules aur aane wale tasks dikhte hain.",
          "Performance tab me sirf score nahi, uska poora hisaab bhi hai — kaunse task se kitni penalty bani.",
        ],
      },
      {
        id: "complete-task",
        title: "Apna task complete karna",
        audience: "everyone",
        summary: "Jo task aapko assign hua hai use Done mark karna.",
        steps: [
          "Tasks tab (ya upar nav me Tasks) me apni list kholein.",
          "Jis task ka kaam ho gaya ho uspar Complete dabayein.",
          "Chahein to remark likhein aur proof file attach karein.",
          "Save karte hi task ka status apne aap tay ho jaata hai — due date se pehle hai to 'Done on Time', baad me hai to 'Delay Done'.",
        ],
        notes: [
          "Task complete karte hi jisne wo assign kiya tha use WhatsApp par confirmation chala jaata hai.",
        ],
      },
      {
        id: "mis",
        title: "MIS score kaise banta hai",
        audience: "everyone",
        summary:
          "Score kisi ne haath se nahi daala — wo aapke tasks ke timestamps se har baar naya calculate hota hai. Ye ek penalty score hai: 0% sabse achha, −100% sabse kharab.",
        how: [
          "Ise number badhane wala score na samjhein — ye galtiyon ka hisaab hai. Sab kuch waqt par ho to 0% aata hai, aur 0% hi sabse achha hai.",
          "Har task ki ek penalty banti hai: waqt par hua to kuch nahi, late hua to aadhi, aur bilkul nahi hua to poori. In sabko jod kar, kitne task ginti me the usse baant diya jaata hai.",
        ],
        steps: [
          "Due date se pehle complete kiya = koi penalty nahi.",
          "Due date ke baad complete kiya = aadhi penalty.",
          "Due date nikal gayi aur task abhi bhi pending = poori penalty.",
          "Score = − (kul penalty ÷ kitne evaluate hue) × 100.",
        ],
        example: {
          title: "Chaar task ka score",
          lines: [
            "  Task 1   waqt par hua        penalty  0",
            "  Task 2   late hua            penalty  0.5",
            "  Task 3   hua hi nahi         penalty  1",
            "  Task 4   waqt par hua        penalty  0",
            "                             ──────────",
            "  Kul penalty                          1.5",
            "  Evaluate hue task                      4",
            "",
            "  Score = -(1.5 / 4) x 100  =  -38%",
          ],
        },
        notes: [
          "Score −100% se aage ja hi nahi sakta — har task se zyada se zyada ek penalty banti hai, isliye ye ganit se hi possible nahi.",
          "Jo task abhi due nahi hua, wo score me ginta hi nahi — na fayda, na nuksaan.",
          "Dashboard ke Performance tab me har task ki alag line hai: kya hua aur kitni penalty bani.",
        ],
      },
    ],
  },

  {
    id: "delegation",
    title: "Task Delegation",
    description: "Doosron ko kaam dene ke liye.",
    sections: [
      {
        id: "assign-task",
        title: "Kisi ko task assign karna",
        audience: "TASK_DELEGATE",
        summary: "Ek baar ka task kisi user ko dena.",
        steps: [
          "Tasks page par Assign Task dabayein.",
          "User chunein — uska Department apne aap dikh jaayega.",
          "Priority chunein (Low / Medium / High / Urgent).",
          "Task ka title aur description likhein.",
          "Completion date aur time daalein — on-time ya delay isi se tay hota hai, minute tak.",
          "Zaroorat ho to file attach karein, phir save karein.",
        ],
        notes: [
          "Jo task aapne diye hain wo 'Delegated by Me' tab me dikhte hain.",
          "Due date sirf tarikh nahi, samay bhi hai — 'aaj shaam 6 baje' aur 'aaj raat 11:59' me farak padta hai.",
        ],
      },
      {
        id: "recurring",
        title: "Recurring task rule banana",
        audience: "RECURRING_ASSIGN",
        summary:
          "Baar-baar hone wale kaam ke liye ek rule banayein — uske occurrences roz apne aap ban jaate hain.",
        steps: [
          "Tasks page par Assign Recurring Task dabayein.",
          "Doer, frequency (Daily / Weekly / 15 Days / Monthly / Quarterly / Yearly), task aur assign date daalein.",
          "Save karein. Rule Active ban jaata hai.",
          "Har raat system us rule ki agli occurrence ek naye task ki tarah bana deta hai.",
        ],
        notes: [
          "Har occurrence apna alag task hoti hai apni due date ke saath — isi wajah se har baar ka on-time/delay alag se score me aata hai.",
          "Holiday List sheet me jo tarikhein hain un par occurrence nahi banti.",
          "Mahine ke aakhir ka dhyan rakha gaya hai — 31 tarikh ka monthly rule February me galat tarikh par nahi girta.",
        ],
      },
      {
        id: "pause-recurring",
        title: "Recurring rule rokna ya dobara chalu karna",
        audience: "RECURRING_ASSIGN",
        summary: "Kaam kuch samay ke liye band karna ho to rule ko pause kar dein.",
        steps: [
          "Tasks page → Recurring Rules tab.",
          "Jis rule ko rokna ho uska Active switch band kar dein.",
          "Dobara chalu karna ho to wahi switch on kar dein.",
        ],
        notes: [
          "Pause karne se sirf nayi occurrences banna band hoti hain. Jo tasks pehle ban chuke hain wo waise hi rahenge aur score me bhi rahenge.",
          "Rule delete karne ki zaroorat nahi — pause karna ulta bhi kiya ja sakta hai, delete nahi.",
        ],
      },
    ],
  },

  {
    id: "inward",
    title: "Inward aur Quality Check",
    description: "Material aane se lekar uske pass/fail hone tak.",
    sections: [
      {
        id: "inward-entry",
        title: "Nayi inward entry banana",
        audience: "INWARD_ENTRY",
        summary: "Material aaya hai to uski entry karna.",
        steps: [
          "Inward page par New Inward Entry dabayein.",
          "Party Name, Invoice No. aur Inward Type (Raw Material / Consumable / Other) daalein.",
          "Invoice ya photo attach karein, remark likhein.",
          "Save karein — entry IQC Status 'Pending' ke saath bann jaati hai.",
        ],
      },
      {
        id: "iqc",
        title: "Quality check karna",
        audience: "IQC_CHECK",
        summary: "Pending entry ko verify karke pass/fail quantity daalna.",
        steps: [
          "Inward page (ya dashboard ke 'Pending Quality Checks' card) me pending entry par Quality Check dabayein.",
          "Invoice se material milaa kar checkbox tick karein.",
          "Pass Qty aur Fail Qty daalein.",
          "Fail Qty ho to Fail Reason likhna zaroori hai.",
          "Save karein.",
        ],
        notes: [
          "Save karte hi entry 'Verified' ho jaati hai.",
          "Fail quantity Failure Log sheet me chali jaati hai, pass quantity IMS Inward sheet me. Dono ho to entry dono jagah jaati hai — ye galat nahi, aisa hi hona chahiye.",
        ],
      },
      {
        id: "quality-records",
        title: "Failure Log aur IMS Inward dekhna",
        audience: "IMS_VIEW",
        summary: "Quality check ka nateeja wapas padhna.",
        steps: [
          "Inward page par Failure Log tab — kaun sa material kitna reject hua aur kyun.",
          "IMS Inward tab — kaun sa material kitna accept hua.",
        ],
        notes: [
          "Dono me Linked Entry ID hoti hai, jisse pata chalta hai wo kis inward entry se aayi.",
        ],
      },
    ],
  },

  {
    id: "inventory-basics",
    title: "Inventory — pehle ye samajh lein",
    description:
      "Do baatein jo samajh aa gayin, uske baad poora IMS apne aap saaf ho jaata hai.",
    sections: [
      {
        id: "ledger-idea",
        title: "Stock kahin likha hua nahi hota — hamesha jod kar nikalta hai",
        audience: "INVENTORY_VIEW",
        summary:
          "Kisi bhi item ka stock ek khaana nahi hai jise koi badalta ho. Har baar material andar aata hai to ek line likhi jaati hai, bahar jaata hai to ek line. Stock in sab lines ka jod hai.",
        how: [
          "Sochiye aapki bank passbook. Usme 'balance' naam ka koi alag khaana nahi hota jise koi haath se badalta ho — har credit aur debit ki apni line hoti hai, aur balance unhi ka jod hota hai. Stock Ledger bilkul waisa hi hai.",
          "Fayda ye hai ki har number ka jawab maujood rehta hai. Agar aaj stock 1,249 dikh raha hai, to ye bataya ja sakta hai ki kis-kis entry se banaa — kab aaya, kaun laaya, kis plan me laga. Ek seedha-sada 'stock' khaana hota to sirf number dikhta, wajah nahi.",
          "Doosra fayda: ye number kabhi purana nahi padta. Koi background job stock update nahi karti, isliye 'job nahi chali, stock galat ho gaya' wali dikkat ho hi nahi sakti. Har baar dekhne par taaza jod hota hai.",
        ],
        example: {
          title: "Ek item ka ledger, aur usse banta hua stock",
          lines: [
            "  Date         Kya hua              Qty       Balance",
            "  ─────────────────────────────────────────────────────",
            "  05 Aug   In   Opening stock       2,000       2,000",
            "  12 Aug   In   Indent receipt      3,000       5,000",
            "  18 Aug   Out  Sample nikala          -50      4,950",
            "  20 Aug   Out  Production PLAN-9N  -3,800      1,150",
            "                                              ───────",
            "                                    Stock =    1,150",
          ],
        },
        notes: [
          "Ledger me koi line mitayi nahi jaati. Galti sudharni ho to ulti entry daali jaati hai — taaki puraana record waisa ka waisa padha ja sake.",
          "Har Out line me ye bhi likha hota hai ki wo kis wajah se nikla — sample, production, ya manual. Isse mahine ke ant me 'material gaya kahan' ka jawab dhoondhna nahi padta.",
        ],
      },
      {
        id: "three-numbers",
        title: "Teen number: On Hand, Free, aur Projected",
        audience: "INVENTORY_VIEW",
        summary:
          "Stock ek number nahi, teen hain — aur teeno ka matlab alag hai. Zyadatar galtiyaan inhi ko aapas me mila dene se hoti hain.",
        how: [
          "On Hand — jo is waqt sach me godown me pada hai. Chhoo kar gina ja sakta hai.",
          "Committed — jo pada to hai, par kisi production plan ne pehle se rok rakha hai. Wo maal us plan ka hai, chahe abhi uthaya na gaya ho.",
          "Free — On Hand me se Committed nikal do. Yahi wo number hai jise dekh kar aap kisi naye kaam ka vaada kar sakte hain. Poore system me jahan bhi 'stock kitna hai' ka faisla hota hai, wahan Free padha jaata hai, On Hand nahi.",
          "In Transit — jiska order ho chuka hai, paisa lag chuka hai, par abhi pahuncha nahi.",
          "Projected — Free me In Transit jod do. Ye batata hai ki maal aa jaane ke baad haalat kya hogi. Reorder isi ko dekhta hai, taaki jo cheez raaste me hai wo dobara order na ho jaaye.",
        ],
        example: {
          title: "Ek item, teen alag jawab",
          lines: [
            "  Godown me pada hai            1,250     <- On Hand",
            "  Ek plan ne rok rakha hai      1,050     <- Committed",
            "                             ────────",
            "  Naye kaam ke liye bacha         200     <- Free",
            "",
            "  Order ho chuka, raaste me       500     <- In Transit",
            "                             ────────",
            "  Maal aane ke baad hoga          700     <- Projected",
          ],
        },
        notes: [
          "1,250 dekh kar kisi ko 1,000 ka vaada kar dena — yahi wo galti hai jo Free number rokta hai. Us 1,250 me se 1,050 pehle se kisi aur ka hai.",
          "Free negative bhi ho sakta hai. Iska matlab hai ki jitna maal hai usse zyada plans ne rok liya hai — ye chhupaya nahi jaata, kyunki chhupane se dikkat baad me aur badi hoti hai.",
        ],
      },
    ],
  },

  {
    id: "inventory",
    title: "Inventory (IMS)",
    description: "Item banane se lekar stock, reorder aur indent tak.",
    sections: [
      {
        id: "item-master",
        title: "Naya item banana",
        audience: "INVENTORY_SETUP",
        summary:
          "Har cheez jiska stock rakhna hai, use pehle ek baar item banana padta hai.",
        steps: [
          "Inventory page par New Item dabayein.",
          "SKU daalein — is item ka pehchan code, jaise RM-SCREW-8X40.",
          "Item ka poora naam, Category (Raw Material ya Consumable), aur Size/Unit daalein.",
          "UOM chunein — ye wo unit hai jisme ye cheez napi jaati hai (PCS, KG, MTR...).",
          "Rate aur Location bhar dein, agar pata ho.",
          "Save karein.",
        ],
        notes: [
          "SKU is item ki pehchan hai. Ek baar bana dene ke baad use badalna ya kisi doosri cheez ke liye dobara istemaal karna nahi chahiye — poora purana record usi SKU se juda hota hai.",
          "UOM soch kar chunein. Aage BOM, plan, indent — sab isi unit me chalenge. Jo cheez PCS me nap-ti hai, uski BOM KG me nahi likhi ja sakti; system khud rok deta hai.",
          "Location sirf ek label hai — likh dene se stock alag-alag jagah ka alag nahi ginta. Ye jaan-boojh kar hai; abhi ek hi pool hai.",
          "Rate abhi sirf jaankari ke liye hai; kisi hisaab me nahi lagta.",
        ],
      },
      {
        id: "stock-in-out",
        title: "Stock In aur Out karna",
        audience: "INVENTORY_TXN",
        summary: "Material andar aaya ya bahar gaya — dono ki entry.",
        steps: [
          "Inventory page par item ke saamne Stock In / Out dabayein.",
          "Direction chunein — In (aaya) ya Out (gaya).",
          "Quantity daalein. Aadha-adhoora bhi chalega, jaise 1.5 ya 0.25.",
          "Source chunein (Opening, Manual, Adjustment...), aur chahein to Issued To aur Remark likhein.",
          "Save karein — ledger me nayi line ban jaati hai aur stock turant badal jaata hai.",
        ],
        notes: [
          "Free stock se zyada Out karne par system rok deta hai, warning nahi deta. Wajah: stock negative ho jaana hamesha kisi galti ka nishaan hota hai — ya typo, ya opening balance daalna reh gaya. Dono ka ilaaj usi waqt sasta hai; hafton baad us gutthi ko suljhana bahut mehnga.",
          "Rok Free par lagti hai, On Hand par nahi. Yaani jo maal kisi plan ne rok rakha hai, use koi doosra nikaal nahi sakta.",
          "Sabse pehli entry aam taur par 'Opening' hoti hai — jo aaj godown me pada hai, wo ek baar daal dein. Uske baad system apne aap chalta rahega.",
        ],
      },
      {
        id: "item-detail",
        title: "Ek item ka poora hisaab dekhna",
        audience: "INVENTORY_VIEW",
        summary:
          "Item ke naam par click karne se uski har entry aur har entry ke baad ka balance dikhta hai.",
        notes: [
          "Sabse upar aaj ka stock, uske neeche har movement — nayi sabse upar.",
          "Har line ke saamne us waqt ka balance likha hota hai, isliye 'stock kab gira' ka jawab scroll karke mil jaata hai.",
          "Production se gaya material ho to uske saamne Plan ID likhi hoti hai, aur indent se aaya ho to Indent ID. Har number ka source pakda ja sakta hai.",
        ],
      },
      {
        id: "planning-fields",
        title: "Planning ke paanch number",
        audience: "INVENTORY_SETUP",
        summary:
          "Ye paanch number bharne se system khud batane lagta hai ki kya, kab aur kitna mangwana hai. Na bharein to stock to dikhega, par salaah nahi milegi.",
        how: [
          "ADC (Average Daily Consumption) — roz ka kitna kharch hota hai. Ye system khud pichhle 30 din ke Out se nikaal leta hai. Agar aap khud daal dein to aapka daala hua number chalega, kyunki naye item ka koi purana kharch hota hi nahi.",
          "Lead Time (din) — order dene se maal pahunchne tak kitne din lagte hain. Supplier se poochh kar sach likhein; ye number jitna galat, salaah utni galat.",
          "Safety Factor — buffer. 1.5 ka matlab 'jitna chahiye uska dedh guna rakho', taaki supplier late ho ya kharch achanak badh jaaye to kaam na ruke.",
          "MOQ (Minimum Order Quantity) — supplier isse kam bechta hi nahi. System kabhi isse kam ka indent nahi banayega.",
          "Max Level — isse zyada bhar kar rakhna paisa phansana hai. Indent banate waqt system yahan tak bharne ki koshish karta hai, isse upar nahi.",
        ],
        notes: [
          "Ye paanch number hi poore reorder ka dimaag hain. Inke bina item 'Not Set Up' dikhega — system jaan-boojh kar chup rehta hai, kyunki adhoore data par andaaza lagana galat salaah dene se bura hai.",
          "Ek aam galti: Max Level ko bahut chhota rakh dena (jaise 5) jabki MOQ bada ho (jaise 300). Aisa karne par har item hamesha 'Overstock' dikhega aur reorder kabhi kuch nahi sujhaayega. Max Level hamesha MOQ se theek-thaak bada rakhein.",
        ],
      },
      {
        id: "bulk-setup",
        title: "Bulk Setup — ek saath bahut saare item bharna",
        audience: "INVENTORY_SETUP",
        summary:
          "Sau item ke planning number ek-ek karke bharna lamba kaam hai. Bulk Setup me sab ek hi screen par bhar kar ek baar me save ho jaate hain.",
        steps: [
          "Inventory → Bulk Setup kholein.",
          "Table me seedhe cell me number type karte jaayein.",
          "Save All dabayein.",
        ],
        notes: [
          "Sirf wahi cell likhe jaate hain jinhe aapne haath lagaya. Isliye agar isi beech kisi ne kisi item ka naam ya category badla ho, to wo mit-ta nahi.",
          "Sab kuch ek hi request me jaata hai, isliye sau item bharne par bhi Google ki limit par bojh nahi padta.",
        ],
      },
      {
        id: "stock-status",
        title: "Item ka rang/status kya bata raha hai",
        audience: "INVENTORY_VIEW",
        summary:
          "Har item ke saamne ek status hota hai. Ye khud nahi likha jaata — Free stock ko Reorder Point se tulna karke nikalta hai.",
        how: [
          "Out of Stock — Free stock khatam. Kaam ab ruk sakta hai.",
          "Critical — Free stock reorder point tak aa gaya. Aaj order karna chahiye.",
          "Low — reorder point ke dedh guna ke andar. Nazar rakhein.",
          "Healthy — theek-thaak pada hai.",
          "Overstock — Max Level se zyada bhara hai. Paisa phansa hua hai.",
          "Not Set Up — planning ke number bhare hi nahi, isliye system kuch keh hi nahi sakta.",
        ],
        notes: [
          "'Not Set Up' koi error nahi hai — ye system ka imaandaar jawab hai ki 'mujhe iska Lead Time aur Max Level nahi pata, isliye main andaaza nahi lagaunga'.",
        ],
      },
      {
        id: "reorder",
        title: "Reorder — kab order karna hai",
        audience: "INVENTORY_VIEW",
        summary:
          "Reorder page batata hai ki kaun sa item khatam hone ke kagaar par hai, aur kitna mangwana chahiye.",
        how: [
          "Reorder Point ka matlab hai: 'itna stock bach jaaye to abhi order kar do, warna maal aane se pehle khatam ho jaayega'.",
          "Hisaab seedha hai — roz ka kharch × maal aane me lagne wale din × safety buffer. Yaani jitna is beech me kharch hoga, utna hamesha pehle se pada hona chahiye.",
          "Tulna Projected stock se hoti hai, Free se nahi. Wajah saaf hai: jo maal pehle hi order ho chuka hai aur raaste me hai, use dobara order karna paisa do baar lagana hai.",
        ],
        example: {
          title: "Ek item ka reorder point",
          lines: [
            "  Roz ka kharch (ADC)              90 PCS",
            "  Supplier ka Lead Time             7 din",
            "  Safety Factor                   1.5",
            "                                ────────",
            "  Reorder Point = 90 x 7 x 1.5    945 PCS",
            "",
            "  Projected stock abhi            700 PCS",
            "  700 < 945  ->  ab order karna chahiye",
          ],
        },
        notes: [
          "Jis item ka reorder point nikal hi nahi sakta (planning number khaali hain), wo is list me aata hi nahi — galat salaah dene se behtar hai chup rehna.",
          "List me sabse upar wo item hota hai jo apne reorder point se sabse zyada neeche gir chuka hai, na ki wo jiski quantity sabse badi hai.",
        ],
      },
      {
        id: "indent-qty",
        title: "Indent me quantity kaise tay hoti hai",
        audience: "INVENTORY_VIEW",
        summary:
          "System khud ek quantity sujhaata hai, par wo sirf sujhaav hai — aap use badal sakte hain.",
        how: [
          "Pehle dekha jaata hai ki kitni kami hai. Phir dekha jaata hai ki Max Level tak bharne ke liye kitna chahiye. Dono me se jo bada ho, wo liya jaata hai — kyunki sirf kami poori karne se agle hafte phir order karna padega.",
          "Uske baad us number ko MOQ se neeche nahi jaane diya jaata, aur MOQ ke poore guna me upar karke round kiya jaata hai — kyunki supplier usi hisaab se hi bechta hai.",
        ],
        example: {
          title: "Quantity ka faisla",
          lines: [
            "  Kami                          200 PCS",
            "  Max Level tak bharne ko       640 PCS   <- ye bada hai",
            "  MOQ                           500 PCS",
            "                              ─────────",
            "  640 ko MOQ ke guna me upar  1,000 PCS   <- sujhaav",
            "",
            "  Screen par ise badal sakte hain.",
          ],
        },
      },
      {
        id: "indents",
        title: "Indent ka poora safar",
        audience: "INDENT_APPROVE",
        summary:
          "Indent yaani purchase request. Wo banne se lekar maal aane tak kuch padaavon se guzarti hai.",
        how: [
          "Pending — request ban gayi, kisi ne abhi manzoori nahi di.",
          "Approved — manzoori mil gayi, ab order jaana hai.",
          "Ordered — supplier ko order chala gaya.",
          "Partially Received — kuch maal aa gaya, kuch baaki.",
          "Received — poora aa gaya.",
          "Cancelled — request rad kar di gayi.",
        ],
        steps: [
          "Reorder page par item chunein, quantity dekh kar chahein to badlein, aur indent banayein.",
          "Indents page par use Approve karein.",
          "Order chale jaane par Ordered mark karein.",
          "Maal aane par Receive dabakar aayi hui quantity daalein.",
        ],
        notes: [
          "Receive karte hi stock In apne aap ban jaata hai — alag se stock entry nahi karni. 'Received mark kar diya, ab stock daalna yaad rakhna' — yahi wo step hai jo log bhool jaate hain, isliye ise ek hi kaam bana diya gaya hai.",
          "Pending indent ko 'raaste me' nahi maana jaata. Wajah: agar bina manzoori wali request bhi in-transit gini jaaye, to ek bhooli hui request asli reorder ki zaroorat ko chhupa degi. Manzoori milte hi wo ginti me aa jaati hai.",
          "Aadha maal aaye to bhi utna stock turant chadh jaata hai, aur baaki ka in-transit me bana rehta hai.",
        ],
      },
      {
        id: "iqc-to-stock",
        title: "Quality check pass hote hi stock kaise badhta hai",
        audience: "IQC_CHECK",
        summary:
          "Inward entry ka quality check pass hone par uski pass quantity apne aap stock me jud jaati hai.",
        how: [
          "Material aata hai to pehle Inward entry banti hai — par wo abhi stock nahi hai, kyunki abhi wo jaanchna baaki hai.",
          "Quality check me jitni quantity pass hoti hai, utni ka stock In apne aap ban jaata hai. Fail quantity Failure Log me chali jaati hai, stock me nahi.",
          "Us stock In line me inward entry ki ID likhi hoti hai, isliye baad me poochha ja sake ki ye maal kis khep se aaya tha.",
        ],
        notes: [
          "Inward entry me item ka SKU daalna zaroori hai — SKU ke bina system ko pata hi nahi chalega ki stock kis item ka badhana hai.",
        ],
      },
    ],
  },

  {
    id: "bom",
    title: "BOM — product kis cheez se banta hai",
    description: "Ek product banane me kya-kya aur kitna lagta hai, wo likh dena.",
    sections: [
      {
        id: "bom-idea",
        title: "BOM hota kya hai",
        audience: "BOM_MANAGE",
        summary:
          "BOM yaani Bill of Materials — ek product ki recipe. Ek unit banane me kaun sa item kitna lagta hai, bas wahi.",
        how: [
          "Jaise ek roti banane ke liye itna aata aur itna paani chahiye — waise hi ek darwaza banane ke liye itne screw, itni tape. BOM me ye 'ek unit ke liye kitna' likha jaata hai, poore order ke liye nahi.",
          "Ek baar likh dene ke baad system khud guna kar leta hai. 100 darwaze ka plan banega to wo khud samajh lega ki 1,600 screw chahiye — aapko calculator nahi kholna.",
          "Isi wajah se BOM sahi hona zaroori hai. Poori production planning, material ki kami ka hisaab, aur indent — sab isi ek table par khade hain.",
        ],
        example: {
          title: "Ek BOM aur uska istemaal",
          lines: [
            "  BOM: Sliding Door 80mm",
            "    SS 304 Screw 8x40    16 PCS  per unit",
            "    Tape 2 inch           2 PCS  per unit",
            "",
            "  100 darwaze ka plan banaya to:",
            "    Screw   16 x 100  =  1,600 PCS",
            "    Tape     2 x 100  =    200 PCS",
          ],
        },
      },
      {
        id: "bom-create",
        title: "Product ki BOM banana",
        audience: "BOM_MANAGE",
        summary: "Ek product banane me kaun sa item kitna lagta hai.",
        steps: [
          "BOM page par Nayi BOM dabayein.",
          "Product ka naam likhein — SKU apne aap ban jaata hai, chahein to badal lein.",
          "Kitne item lagenge wo ginti daal kar Rows banayein dabayein.",
          "Har row me item chunein aur ek unit ke liye quantity likhein.",
          "BOM banayein dabayein.",
        ],
        notes: [
          "Item chunte hi uska SKU aur unit apne aap aa jaate hain — BOM me wahi unit rahega jisme item nap-ta hai. Isliye PCS wali cheez ki BOM galti se KG me nahi likhi ja sakti.",
          "Quantity aadhi-adhoori bhi ho sakti hai — 1.5 ya 0.25 chalta hai.",
          "Ek hi item do baar daalne par system rok dega aur naam bata dega. Wajah: 12 aur 4 ko chupchaap jod kar 16 kar dena bilkul sahi dikhta hai, aur wo galti baad me pakadna namumkin ho jaata hai. Dono quantity ek hi line me jodkar likhein.",
          "Product SKU khud ban jaata hai naam se, jaise 'Sliding Door 80mm' se FG-SLIDING-DOOR-80MM. Aapka apna coding system ho to badal lein.",
        ],
      },
      {
        id: "bom-versions",
        title: "BOM badalna — purani kahan jaati hai",
        audience: "BOM_MANAGE",
        summary:
          "Kisi product ki BOM dobara banane par nayi version banti hai aur purani Archived ho jaati hai — mitti nahi.",
        how: [
          "Maan lijiye pehle 12 screw lagte the, ab design badla aur 16 lagne lage. Aap nayi BOM save karte hain — wo v2 ban jaati hai aur v1 Archived ho kar bhi padhne layak rehti hai.",
          "Ye zaroori kyun hai: teen mahine baad agar kisi batch ki shikayat aati hai, to sawaal hoga 'us waqt isme kya laga tha'. Agar purani BOM ke upar hi likh diya gaya hota, to us sawaal ka koi jawab hi na bachta.",
          "Aur purane plans par iska koi asar nahi padta — har plan apni BOM ki copy khud ke saath rakh leta hai (agla section).",
        ],
        notes: [
          "Purani versions dekhne ke liye BOM page par 'Purani versions' dabayein.",
          "Ek product ka SKU version badalne par nahi badalta — warna ek hi product do alag pehchaan me bant jaata.",
        ],
      },
    ],
  },

  {
    id: "ppc",
    title: "PPC — Production Planning",
    description:
      "Kya banana hai, kab banana hai, uske liye material hai ya nahi, aur wo material kis ke liye rok diya gaya hai.",
    sections: [
      {
        id: "ppc-idea",
        title: "PPC kaam kaise karta hai — sabse zaroori baat",
        audience: "PPC_PLAN",
        summary:
          "Jab aap ek saath kai product ka plan banate hain, to system unhe ek-ek karke nahi, ek hi common stock me se baant kar dekhta hai. Yahi is poore module ki jaan hai.",
        how: [
          "Sochiye godown me 100 screw hain. Aapko do product banane hain — ek me 80 screw lagenge, doosre me 60.",
          "Agar system dono ko alag-alag check kare, to pehle ke liye dekhega '100 me se 80 chahiye — ho jaayega', aur doosre ke liye bhi '100 me se 60 chahiye — ho jaayega'. Dono ko hari jhandi mil jaayegi. Par sach ye hai ki dono milkar 140 maangte hain aur hai sirf 100. Ye galti kaagaz par kabhi nahi dikhti — production ke din dikhti hai, jab maal khatam mil-ta hai.",
          "Isliye system stock ko ek pool maanta hai aur us me se baant-ta jaata hai. Jiski production date pehle hai, use pehle milta hai — kyunki wahi pehle banega; jo teen hafte baad banega wo indent aane ka intezaar kar sakta hai.",
          "Baant-ne ke baad bhi har product ka apna alag status dikhta hai — ek Ready ho sakta hai aur doosra Shortage. Total imaandaar rehta hai aur har product ki apni tasveer bhi saaf rehti hai.",
        ],
        example: {
          title: "100 screw, do product — sahi aur galat tarika",
          lines: [
            "  GALAT (har product alag-alag dekha):",
            "    Product A   chahiye 80   stock 100   -> Ready",
            "    Product B   chahiye 60   stock 100   -> Ready",
            "    Dono Ready. Par 80+60 = 140 aur hai sirf 100.",
            "",
            "  SAHI (ek hi pool me se baanta gaya):",
            "    Product A   22 Aug   chahiye 80   mila 80   -> Ready",
            "    Product B   25 Aug   chahiye 60   mila 20   -> Shortage 40",
            "    A pehle banega, isliye use pehle mila.",
            "    B ke 40 ke liye indent raise kar dein.",
          ],
        },
        notes: [
          "Isi wajah se ek saath banne wale saare product ek hi plan me daalein. Alag-alag baar me daalenge to bhi system galat nahi hoga — jo pehle ban gaya wo apna material rok chuka hoga — par ek saath daalne par aapko poori tasveer pehle hi dikh jaati hai.",
          "Ek hi date ke do product hon to jo pehle chuna gaya, use pehle milta hai.",
        ],
      },
      {
        id: "ppc-reserve",
        title: "Reserve — plan banate hi material ruk jaata hai",
        audience: "PPC_PLAN",
        summary:
          "Plan bante hi jitna material mila, wo us plan ke naam ho jaata hai. Baaki poore system ko wo stock ab dikhna band ho jaata hai.",
        how: [
          "Reserve ka matlab hai: maal godown me hi pada hai, par ab wo kisi aur kaam ke liye 'free' nahi ginta.",
          "Iska asar turant har jagah dikhta hai — Inventory page par Free stock kam ho jaata hai, reorder page use kami maan kar order sujhaane lagta hai, aur agla plan use utha nahi sakta.",
          "Yahi wajah hai ki plan ka koi 'draft' nahi hota jo bina material roke pada rahe. Aisa draft 'Ready' dikhta rehta aur usi stock par doosra plan bhi ban jaata — theek wahi galti jo ye poora design rokne ke liye bana hai.",
          "Material kam hone par bhi plan banta hai. Jitna mila utna reserve ho jaata hai, aur baaki ka Shortage me dikhta hai. Ye bhi jaan-boojh kar hai: jo maal is plan ko mil chuka hai wo iska hai, warna agla plan use le jaata aur is plan ki kami chupchaap aur badh jaati.",
        ],
        notes: [
          "Plan cancel karte hi poora reserve free ho jaata hai. Kuch bhi ledger me nahi likha jaata, kyunki material abhi utha hi nahi tha.",
        ],
      },
      {
        id: "ppc-plan",
        title: "Production plan banana",
        audience: "PPC_PLAN",
        summary:
          "Jo product banane hain unka plan, aur uske liye material ka reserve ho jaana.",
        steps: [
          "PPC page par Naya plan dabayein.",
          "Jo product ek saath banane hain, sabko ek hi baar me daalein — product, quantity aur production date.",
          "Material check karein dabakar dekhein kis product ka kya material kam pad raha hai.",
          "Plan banayein dabayein.",
        ],
        notes: [
          "'Material check karein' sirf dikhata hai, kuch likhta nahi. Wo wahi hisaab chalata hai jo asli plan banane par chalega, isliye jo dikha wahi hoga.",
          "Sirf un product ka plan ban sakta hai jinki active BOM maujood hai.",
          "Har product apna alag plan banta hai, kyunki production, shuruaat aur completion har product ki apni hoti hai. Par material sabko ek saath baanta jaata hai.",
        ],
      },
      {
        id: "ppc-snapshot",
        title: "Plan apni BOM ki copy rakh leta hai",
        audience: "PPC_PLAN",
        summary:
          "Plan bante waqt us product ki BOM ki ek copy plan ke saath likh di jaati hai. Baad me BOM badalne se purana plan nahi badalta.",
        how: [
          "Maan lijiye 20 August ko aapne 100 darwazon ka plan banaya jab BOM me 16 screw the. 25 August ko design badla aur BOM me 18 screw ho gaye.",
          "Agar plan har baar BOM se number uthata, to wo purana plan achanak 1,800 screw maangne lagta — jabki wo 1,600 par hi bana tha aur usi hisaab se material rok chuka tha. Poora record apne aap badal jaata.",
          "Isliye plan apni copy rakh leta hai. Purana plan waisa ka waisa rehta hai, naye plan nayi BOM par bante hain.",
        ],
        notes: [
          "Plan ke saamne 'Material' dabakar wahi copy dekhi ja sakti hai, uske BOM version ke saath.",
        ],
      },
      {
        id: "ppc-shortage",
        title: "Material kam ho to kya karein",
        audience: "PPC_PLAN",
        summary:
          "Shortage wala plan ruka hua nahi hota — jitna mila utna uske paas hai, aur baaki ka intezam kiya ja sakta hai.",
        steps: [
          "Plan ke saamne 'Material' dabakar dekhein kis item ka kitna kam hai.",
          "Reorder / Indents page se us item ka indent banayein aur approve karwayein.",
          "Maal aane par indent Receive karein — stock apne aap chadh jaayega.",
          "Wapas PPC par aakar us plan par 'Dobara check' dabayein.",
        ],
        notes: [
          "'Dobara check' ke bina plan hamesha ke liye Shortage me atka rahega, chahe maal aa bhi jaaye. Ye button plan ko aaj ke stock se dobara tolta hai aur jitna mil sakta hai utna usme jod deta hai.",
          "Dobara check sirf usi plan ki kami bharta hai. Doosre plans ka roka hua material wo chhoo bhi nahi sakta.",
          "Shortage se banaya indent abhi exact kami ke barabar hota hai, MOQ ke guna me round nahi hota — quantity aap khud badal sakte hain.",
        ],
      },
      {
        id: "ppc-start",
        title: "Production shuru karna",
        audience: "INVENTORY_TXN",
        summary:
          "Actual quantity daal kar material issue karna — yahin par stock sach me ghat-ta hai.",
        how: [
          "Plan banne par material sirf ruka tha, ghata nahi tha. Ghat-ta wo ab hai, jab production sach me shuru hota hai.",
          "System poochhta hai ki kitne unit sach me ban rahe hain — plan wali quantity apne aap nahi maan leta. Plan 400 ka tha par 380 hi bane, to material bhi 380 ka hi nikalna chahiye. Plan wala number maan lena stock ko dheere-dheere haqeeqat se door kar deta hai.",
          "Jitne unit nahi bane, unka roka hua material usi waqt free ho jaata hai — taaki wo kisi aur kaam aa sake, agle mahine tak bekaar na ruka rahe.",
        ],
        steps: [
          "PPC page par plan ke saamne Production shuru dabayein.",
          "Kitne unit actually ban rahe hain wo quantity daalein.",
          "Material issue karein dabayein.",
          "Kaam khatam hone par Complete dabayein.",
        ],
        example: {
          title: "Plan 400 ka tha, bane 380",
          lines: [
            "  Ek unit me 10 screw",
            "  Plan             400 unit  ->  4,000 screw reserve the",
            "  Actually bane    380 unit",
            "",
            "  Nikla (Out)      380 x 10  =  3,800 screw",
            "  Free hua                       200 screw",
            "                                 (20 unit ka bacha reserve)",
          ],
        },
        notes: [
          "Material nikalne se pehle system har item ko jaanch leta hai. Agar kisi ek ka bhi stock kam pada, to koi bhi entry nahi hoti aur poora kaam ruk jaata hai — taaki aadha material nikal kar plan beech me atka na reh jaaye.",
          "Har issue Stock Ledger me Out ban kar jaata hai, jisme Plan ID likhi hoti hai. Baad me poochha ja sake ki ye material kis production me gaya.",
        ],
      },
    ],
  },

  {
    id: "team",
    title: "Team",
    description: "Doosron ka kaam dekhne ke liye.",
    sections: [
      {
        id: "performance",
        title: "Team performance dekhna",
        audience: "PERFORMANCE_VIEW",
        summary:
          "Poori team ka score ek jagah — sabse kharab sabse upar, taaki dhyan wahin jaaye jahan zaroorat hai.",
        steps: [
          "Dashboard tab me neeche Performance section kholein.",
          "Upar se period chunein — Aaj, hafta, mahina, saal, ya apni date range.",
          "Excel export dabakar wahi list download karein jo screen par dikh rahi hai.",
        ],
        notes: [
          "0% se −20% theek hai, −21% se −50% par dhyan dein, −50% se neeche kharab.",
          "Har user ke saath On Time, Delay aur Not Done ka breakdown hai — sirf final number nahi.",
          "Ye wahi hisaab hai jo user apne dashboard par khud dekhta hai, toh number kabhi alag nahi hoga.",
          "Export me wahi period jaata hai jo screen par chuna hua hai. File .csv hai, jo Excel me seedhe khulti hai.",
        ],
      },
    ],
  },

  {
    id: "admin-setup",
    title: "Poora system setup karna",
    description: "Sirf organization Admin ke liye — pehli baar system khada karne ka poora tarika.",
    sections: [
      {
        id: "how-it-works",
        title: "System kaam kaise karta hai",
        audience: "admin",
        summary:
          "Aapke organization ka saara data aapke apne Google Sheets me rehta hai. Pro ERP un sheets ko ek service account ke zariye padhta-likhta hai. Isliye har sheet ko us service account ke saath share karna zaroori hai.",
        notes: [
          "Har module ki apni alag Google Sheet hoti hai. Header rows aap ko nahi banane — pehli baar likhte waqt system khud bana deta hai.",
          "Agar aap sheet se hamara access hata denge to us module ka kaam wahin ruk jaayega.",
        ],
      },
      {
        id: "connect-sheets",
        title: "Module sheets connect karna",
        audience: "admin",
        summary: "Har module ke liye ek blank Google Sheet banakar uska URL paste karna.",
        steps: [
          "Google Drive me ek folder banayein, aur use service account email ke saath Editor access se share karein (email Settings page par likha hai).",
          "Us folder ke andar har module ke liye ek blank sheet banayein (poori list neeche hai).",
          "Folder share hone se andar ki saari sheets ko access mil jaata hai — har sheet alag se share karne ki zaroorat nahi.",
          "Admin → Settings me har module ke saamne uska URL paste karke Save karein.",
        ],
        example: {
          title: "Kaun si sheet kis kaam ke liye",
          lines: [
            "  Tasks                  ek baar ke task",
            "  Recurring Tasks        baar-baar wale kaam ke rules",
            "  Holiday List           chhutti ki tarikhein",
            "  Inward & IQC FMS       aane wala material + quality check",
            "  Failure Log            jo quality me fail hua",
            "  IMS Inward             jo pass hua",
            "",
            "  Items                  item master (SKU, UOM, planning)",
            "  Stock Ledger           har In / Out ki line — stock isi se",
            "  Indents                purchase requests",
            "  BOM                    product ki recipe",
            "  Production Plans       kya, kitna, kab banana hai",
            "  Plan Materials         har plan ki BOM copy + reserve",
          ],
        },
        notes: [
          "Saari sheets ek saath banane ki zaroorat nahi. Jo module aap abhi chala rahe hain, sirf uski sheet connect karein — baaki baad me jodi ja sakti hain.",
          "Inventory chalane ke liye kam se kam Items aur Stock Ledger dono chahiye. PPC ke liye Production Plans aur Plan Materials dono chahiye — ek se kaam nahi chalega.",
          "Sheet me header row aapko nahi banani. Pehli baar likhte waqt system khud bana deta hai, aur baad me koi naya column joda jaaye to wo bhi apne aap add ho jaata hai.",
          "Save karte waqt system turant check karta hai ki us sheet tak pahunch hai ya nahi — galti wahin pakdi jaati hai.",
          "Holiday List me tarikhein YYYY-MM-DD format me, plain text ke roop me daalein (column ko Plain Text format karein, ya har entry se pehle ' lagayein). Warna Google unhe apne format me badal deta hai aur match nahi hota.",
        ],
      },
      {
        id: "attachments",
        title: "Attachments ka folder",
        audience: "admin",
        summary:
          "Task aur inward ke saath jo files lagti hain, wo kahan jaayengi.",
        steps: [
          "Admin → Settings me File Storage (Drive Folder) me apne folder ka URL paste karein.",
          "Save karte waqt system ek test file upload karke turant bata dega ki folder chalega ya nahi.",
        ],
        notes: [
          "Zaroori: folder ek Shared Drive ke andar hona chahiye (Google Workspace waalon ke paas hi hota hai), aur service account ko Content Manager access chahiye.",
          "Personal 'My Drive' ka folder kaam nahi karega — Google service account ko personal Drive me file rakhne hi nahi deta. Ye hamari kami nahi, Google ka niyam hai.",
          "Agar aap Drive folder connect nahi karte, ya wo kaam nahi karta, to files apne aap platform ke apne storage me chali jaati hain. Aapka kaam kisi haal me rukega nahi.",
        ],
      },
      {
        id: "users",
        title: "Users banana aur access dena",
        audience: "admin",
        summary:
          "Har user ko banate waqt tay karein ki wo system ke kaun se hisse me kaam karega.",
        steps: [
          "Admin → Users → Add User.",
          "Naam, email, password, role, department aur WhatsApp number daalein.",
          "System Access me wahi modules tick karein jo us user ko chahiye.",
          "Create karein — aur password user ko bhej dein.",
        ],
        notes: [
          "Role aur access do alag cheezein hain. Role batata hai ki wo Admin hai ya nahi; access batata hai ki wo kis module me kaam karega. Kisi ko task assign karne dene ke liye ab use Admin banane ki zaroorat nahi — bas wo checkbox tick kar dein.",
          "Admin ke paas har module ka access apne aap hota hai.",
          "Jo modules aap tick karenge, wahi us user ke dashboard par tabs banke dikhenge.",
          "Password bhool jaane par Manage → Reset Password se naya banayein. Purana kabhi dekha nahi ja sakta.",
        ],
      },
      {
        id: "whatsapp",
        title: "WhatsApp (ChatXFlow) jodna",
        audience: "admin",
        summary: "Task confirmation aur roz ke reminder WhatsApp par bhejne ke liye.",
        steps: [
          "chatxflow.online par apna WhatsApp number connect karein aur Developer API Token lein.",
          "Admin → Settings → WhatsApp me token, number aur base URL daal kar Save karein.",
          "Send Test Message dabayein — asli message aapke number par aana chahiye.",
        ],
        notes: [
          "Do cheezein apne aap chalti hain: task complete hone par assign karne wale ko confirmation, aur roz sabko unke pending tasks ki list.",
          "Reminder usi number par jaata hai jo user ke profile me hai — isliye users banate waqt sahi WhatsApp number daalein.",
          "Message na pahunche to sabse pehle chatxflow.online par dekhein ki aapka WhatsApp session abhi bhi connected hai.",
        ],
      },
      {
        id: "automation",
        title: "Roz apne aap kya chalta hai",
        audience: "admin",
        summary: "Do kaam har raat/subah bina kisi ke chalte hain.",
        notes: [
          "Recurring rules ki agli occurrences banti hain (holidays chhod kar).",
          "Har user ko unke pending tasks ka WhatsApp reminder jaata hai.",
          "Dono ek din me ek baar hi chalte hain, aur dobara chalne par duplicate nahi banate.",
          "Settings page se 'Send Reminders Now' dabakar aap khud bhi turant bhej sakte hain.",
        ],
      },
      {
        id: "troubleshooting",
        title: "Kuch kaam na kare to",
        audience: "admin",
        summary: "Aam dikkatein aur unka pehla ilaaj.",
        notes: [
          "\"Sheet configure nahi hui hai\" — Settings me us module ka URL paste karna baaki hai.",
          "\"Access nahi mil paya\" — sheet ya folder service account ke saath share nahi hui, ya share hata di gayi.",
          "User login nahi kar pa raha — password sheet se copy mat karwayein (wo hash hai). Reset Password se naya dein.",
          "User ko koi tab nahi dikh raha — uske System Access me kuch tick nahi hua hai.",
          "WhatsApp nahi ja raha — Settings me Send Test Message se check karein, phir ChatXFlow ka session dekhein.",
        ],
      },
    ],
  },

  {
    id: "platform",
    title: "Platform operations",
    description: "Sirf platform operator ke liye — poore install ka intezaam.",
    sections: [
      {
        id: "onboarding",
        title: "Naya organization kaise judta hai",
        audience: "platform",
        summary:
          "Koi bhi organization khud signup kar sakta hai — aapko kuch karne ki zaroorat nahi.",
        steps: [
          "Wo /signup par jaakar ek blank Google Sheet banata hai.",
          "Us sheet ko service account ke saath Editor access se share karta hai.",
          "Organization ka naam, apna admin account aur sheet ka URL daalta hai.",
          "System sheet me Users aur Settings tabs bana deta hai, organization register karta hai, aur use Admin bana kar login kara deta hai.",
        ],
        notes: [
          "Ek hi sheet do organizations ko nahi di ja sakti, aur ek email poore platform par ek hi baar ban sakta hai — login sirf email maangta hai, isliye wo unique hona zaroori hai.",
        ],
      },
      {
        id: "suspend",
        title: "Organization suspend karna",
        audience: "platform",
        summary: "Platform page se kisi organization ko rok dena.",
        steps: [
          "Platform page par us organization ka Active switch band kar dein.",
        ],
        notes: [
          "Uske saare users agli hi request par bahar ho jaate hain aur uske automated kaam bhi ruk jaate hain.",
          "Data, sheets aur users kuch bhi delete nahi hota — switch wapas on karte hi sab pehle jaisa chalne lagta hai.",
        ],
      },
      {
        id: "health",
        title: "Deployment check karna",
        audience: "platform",
        summary:
          "/api/health kholne par pata chalta hai ki live par kaun sa version chal raha hai aur kaun si settings maujood hain.",
        notes: [
          "commit batata hai ki abhi ka code deploy hua ya nahi — 'push kiya tha, gaya ki nahi' ka jawab yahin milta hai.",
          "configured me har zaroori setting ke saamne true/false hota hai. Uski value kabhi nahi dikhti, sirf hai ya nahi hai.",
        ],
      },
      {
        id: "limits",
        title: "Jo cheezein dhyan me rakhni hain",
        audience: "platform",
        summary: "Is install ki asli seemaayein.",
        notes: [
          "Saare organizations ek hi Google service account se chalte hain, aur Google ki request limit us poore project par lagti hai — har organization par alag nahi. Bahut saare organizations ek saath chalne par ye pehle tang karegi.",
          "Ek hi record ko do log theek ek hi samay par edit karein to ek ka badlaav dab sakta hai. Alag-alag log apna-apna kaam karein to koi dikkat nahi.",
          "File upload ki seema 4MB hai.",
          "Automated kaam din me ek baar chalte hain.",
        ],
      },
    ],
  },
];

/** Everything a viewer with these grants is meant to read, empty chapters dropped. */
export function guideFor(options: {
  role: string;
  access: readonly string[];
  isPlatformAdmin: boolean;
}): GuideChapter[] {
  const isAdmin = options.role === "Admin";
  // An Admin holds every module grant implicitly; be explicit so the guide never hides
  // a module's instructions from the person expected to explain it to their team.
  const grants = new Set<string>(isAdmin ? MODULE_ACCESS_KEYS : options.access);

  return GUIDE.map((chapter) => ({
    ...chapter,
    sections: chapter.sections.filter((section) => {
      if (section.audience === "everyone") return true;
      if (section.audience === "admin") return isAdmin;
      if (section.audience === "platform") return options.isPlatformAdmin;
      return grants.has(section.audience);
    }),
  })).filter((chapter) => chapter.sections.length > 0);
}
