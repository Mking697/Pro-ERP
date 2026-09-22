import { MODULE_ACCESS_KEYS, type ModuleAccessKey } from "@/lib/moduleAccess";
import type { Locale } from "@/lib/preferences";
import { GUIDE_EN } from "@/lib/guide.en";

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
          "Ye aapke organization ka kaam-kaaj sambhalne wala system hai — task delegation, recurring kaam, material inward aur quality check, inventory aur stock, product ki BOM, production planning, aur sabki performance scoring. Aapka data poori tarah aapke organization tak seemit hai — kisi doosre organization ko kabhi nahi dikhta.",
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
        id: "nav-groups",
        title: "Upar ka nav bar — MDO, PMS, Stock, FMS, Others",
        audience: "everyone",
        summary:
          "Upar ka menu ab groups me bant gaya hai, taaki roz ke kaam aur setup wale link ek dusre me na mile.",
        how: [
          "MDO (day-to-day kaam) — Tasks, Flow (aapke FMS steps), Leave, Reports, aur access ho to Performance.",
          "PMS (production) — BOM, PPC, aur har wo FMS Line jise koi production plan sach me chalata hai.",
          "Stock — Inventory (raw material/consumable) aur alag se Finished Goods.",
          "FMS — Inward, Purchase, aur har doosra flow jo production Line nahi hai.",
          "Others — Vendors/Customers, Users, Settings, aur (platform operator ke liye) Platform.",
        ],
        notes: [
          "Ek group me sirf wahi links dikhte hain jinka access aapke paas hai — koi group khali ho to wo poora hi nahi dikhta.",
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
      {
        id: "whats-new",
        title: "Upar ki ghanti — Naye updates",
        audience: "everyone",
        summary:
          "Header me Settings ke bagal wali ghanti (bell) dabane se pata chalta hai ki system me kya-kya naya aaya hai.",
        notes: [
          "Jab bhi koi naya update hota hai jo aapne abhi tak nahi dekha, ghanti par ek chhota number dikhta hai.",
          "Ghanti dabate hi wo sab 'dekh liya' maan liya jaata hai — agli baar naya update aane tak number wapas nahi aayega.",
          "Ye sirf aapke is browser me yaad rehta hai — doosre device ya browser par khola to ho sakta hai wahi updates dobara 'naye' dikhein.",
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
          "Party Name type karein — Vendor Master me registered ho to list se chun sakte hain, warna naya naam bhi likh sakte hain. Invoice No. aur Inward Type (Raw Material / Consumable / Other) bhi daalein.",
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
        id: "bulk-import-items",
        title: "Bahut saare naye item ek saath banana",
        audience: "INVENTORY_SETUP",
        summary:
          "Ek-ek karke item banana lambi list ke liye theek nahi — Bulk Import se Excel/CSV se ek baar me sab ban jaate hain.",
        steps: [
          "Inventory page par Bulk Import dabayein.",
          "Template Download karein — isme wahi columns hain jo New Item form me hain.",
          "Template ki example row hata dein, apna data usi format me bhar dein, phir file save karein (CSV ya Excel dono chalte hain).",
          "Wapas Bulk Import dialog me wahi file upload karein aur Import karein dabayein.",
        ],
        notes: [
          "SKU khaali chhoda ja sakta hai — New Item form ki tarah, khud ban jaata hai.",
          "Template me ek 'Opening Stock' column bhi hai jo New Item form me nahi hai — usme quantity likh denge to us item ka stock alag se Stock In kiye bina hi turant ban jaata hai, ek 'Opening' entry ke roop me.",
          "Kisi row me galti ho (naam khaali, galat Category, ya SKU pehle se maujood) to sirf wahi row skip hoti hai aur wajah dikhai jaati hai — baaki saare items ban jaate hain.",
          "Column headers ka spelling/spacing thoda idhar-udhar ho to bhi chalega (jaise 'Item_Name' ya 'Item Name' dono), lekin sabse aasan raasta wahi hai jo template deta hai.",
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
      {
        id: "fg-inventory",
        title: "Finished Goods apni alag jagah",
        audience: "INVENTORY_VIEW",
        summary:
          "Stock (Others) group me Inventory aur Finished Goods do alag boards hain — taaki bana hua maal raw material/consumable ki list me kabhi mix na ho.",
        how: [
          "Dono ek hi tarah ka ledger istemaal karte hain — sirf yahi tay hota hai ki ek item Category me 'FG' hai ya nahi, usi se wo kis board par dikhega.",
          "Main Inventory page ab FG chhod kar sab dikhata hai. FG page (/inventory/fg) sirf FG dikhata hai, aur wahan New Item banane par Category apne aap 'FG' chuni hui aati hai.",
          "Production complete hone par jo FG stock banta hai (PPC ke 'ppc-start' section me, ya kisi FMS Production Line ke last step ki Action se), wo isi FG board par aa kar dikhta hai.",
        ],
      },
    ],
  },

  {
    id: "parties",
    title: "Purchase Vendor & Customer Master",
    description: "Vendor aur customer ka master data — aage PO aur sales order isi se juden ge.",
    sections: [
      {
        id: "parties-idea",
        title: "Ye form sirf Purchase Vendor ke liye hai",
        audience: "PARTY_MASTER",
        summary:
          "Abhi jo Vendor banaya jaata hai, wo 'Purchase Vendor' hai — jisse aap material khareedte hain. Aage OEM ya Manufacturing Vendor jaise dusre types alag se aa sakte hain, isliye naam khaas kar ke 'Purchase Vendor' rakha gaya hai.",
        notes: [
          "Ek naam duplicate (chhote-bade letters/space ka farak chhod kar) dikhe to system rok-ta nahi, sirf warning deta hai — chahe wo pehle se maujood ek row ho ya isi import file ki koi doosri row.",
        ],
      },
      {
        id: "vendor-create",
        title: "Naya Purchase Vendor banana",
        audience: "PARTY_MASTER",
        summary: "Ek vendor ka master record.",
        steps: [
          "Vendors/Customers page → Purchase Vendors tab → '+ Add' dabayein.",
          "Vendor ka naam aur contact details bharein.",
          "Save karein.",
        ],
        notes: [
          "Bahut saare vendor ek saath banane ho to Bulk Import (Excel/CSV, Items ki tarah hi template-download-fill-upload) istemaal karein.",
        ],
      },
      {
        id: "vendor-items",
        title: "Vendor ko Item se jodna — lead time aur price",
        audience: "PARTY_MASTER",
        summary:
          "Ek vendor kaun se item supply karta hai, kitne din me (lead time), aur kis price par — ye link banate hi Purchase FMS aur reorder isko istemaal karne lagte hain.",
        steps: [
          "Vendor ke saamne 'Items' dabayein.",
          "Item chunein, uska Lead Time (din) aur Unit Price bharein.",
          "Save karein — ek hi vendor-item pair par dobara save karne se purana number update ho jaata hai (naya row nahi banta).",
        ],
        notes: [
          "Jab kisi item ka indent raise hota hai, to us item ke jitne vendor jude hain sab suggest hote hain — sabse sasta (last price ke hisaab se) sabse upar. Jis vendor ka price hi nahi bhara, wo list me sabse neeche aata hai.",
          "PO Issue screen par bhi ye link hi kaam aata hai — jab tak ek vendor kisi item se linked nahi hoga, us item ka indent us vendor ki PO list me suggest hi nahi hoga.",
        ],
      },
      {
        id: "customer-create",
        title: "Naya Customer banana",
        audience: "PARTY_MASTER",
        summary: "Ek customer ka master record — aage Sales chain (jab banegi) isi se judegi.",
        steps: [
          "Vendors/Customers page → Customers tab → '+ Add' dabayein.",
          "Naam aur contact details bharein, Save karein.",
        ],
        notes: ["Customers ka bhi apna Bulk Import hai, Vendors jaisa hi."],
      },
    ],
  },

  {
    id: "purchase",
    title: "Purchase (Indent se Material aane tak)",
    description:
      "Indent Approve hote hi khud shuru ho jaane wala flow — PO Issue, Follow Up, aur Material Received.",
    sections: [
      {
        id: "purchase-idea",
        title: "Purchase flow kaam kaise karta hai",
        audience: "PURCHASE_FMS",
        summary:
          "Jaise hi koi indent Approve hoti hai, ye flow khud shuru ho jaata hai — kisi ko haath se start nahi karna padta.",
        how: [
          "Step 1 — Indent Approve: ye Inventory ke Indents page se hi hota hai (indent-approve section dekhein), yahin se ye poora flow trigger hota hai.",
          "Step 2 — PO Issue: ek vendor chunte hi us vendor se jude saare Approved indent suggest ho jaate hain — ek hi PO me kai items bundle kiye ja sakte hain.",
          "Step 3 — Follow Up: PO ke baad vendor se follow-up lene ka actionable step. Iski deadline vendor ke Lead Time se khud nikalti hai (Lead Time se ek din pehle) — taaki maal aane se pehle hi ek reminder mil jaaye.",
          "Step 4 — Material Received: invoice aur per-item quantity (poora ya adha) daal kar maal receive karna — yahi wahi 'receive' logic hai jo Indent ke apne Receive step me bhi chalta hai, isliye stock turant sahi jud jaata hai.",
        ],
        notes: [
          "Ye ek FMS jaisa hi flow hai lekin generic Template builder se nahi banaya — ye chaar step fix hain, isliye har step ka apna alag screen hai.",
        ],
      },
      {
        id: "purchase-setup",
        title: "Purchase Setup — har step ka Doer aur TAT",
        audience: "admin",
        summary:
          "Admin → Settings → Purchase Setup me tay karein har step kisko milega aur kitne din/ghante me karna hai.",
        steps: [
          "Admin → Settings kholein, Purchase Setup section dhoondhein.",
          "Step 1 (PO Issue) aur Step 2 (Follow Up) ke liye Doer aur TAT bharein.",
          "Step 3 (Material Received) ke liye sirf Doer bharein — iska TAT khud vendor ke Lead Time se nikalta hai, alag se nahi bharna.",
          "Save karein.",
        ],
        notes: [
          "Ye setup na bhara ho to bhi indent approve hoke flow ban jaayega — TAT ke liye ek default use hoga, par sahi salaah ke liye ise bhar dena chahiye.",
        ],
      },
      {
        id: "purchase-po-issue",
        title: "PO Issue karna",
        audience: "PURCHASE_FMS",
        summary: "Ek vendor chun kar uske saare pending indent ek PO me bundle karna.",
        steps: [
          "Purchase page → PO Issue tab.",
          "Vendor chunein — us vendor se jude saare Approved indent apne aap tick ho kar dikh jaate hain, unke last price ke saath.",
          "Jo item nahi chahiye uska tick hata dein, chahiye to New Price badal dein.",
          "PO Attachment (quotation/PO copy) laga kar 'PO Issue karein' dabayein.",
        ],
        notes: [
          "Jis item ka koi vendor link hi nahi hai, wo kisi vendor ki list me kabhi nahi aayega — pehle Parties me us item ko us vendor se jodna hoga.",
          "New Price yahan se jo bharenge, wo hi is PO ka record ban jaata hai — Old Price (vendor ke link wala last price) hamesha saath dikhta hai, taaki price badlav turant nazar aaye.",
        ],
      },
      {
        id: "purchase-follow-up",
        title: "Follow Up karna",
        audience: "PURCHASE_FMS",
        summary: "PO ke baad vendor se follow-up lena aur mark karna ki ho gaya.",
        steps: [
          "Purchase page → Follow Up tab — jin PO ki follow-up deadline aa gayi/aane wali hai wo yahan dikhte hain.",
          "Vendor se baat karke, remark likh kar 'Done' mark karein.",
        ],
        notes: [
          "Iski deadline PO ke Lead Time se ek din pehle khud set hoti hai — isse haath se badalna nahi padta.",
        ],
      },
      {
        id: "purchase-material-received",
        title: "Material Received karna",
        audience: "PURCHASE_FMS",
        summary: "Maal aane par invoice ke saath quantity daalna — stock yahi se badhta hai.",
        steps: [
          "Purchase page → Material Received tab.",
          "Jis PO ka maal aaya uski line par invoice attach karein aur per-item quantity daalein (poora ya adha, jitna sach me aaya).",
          "Save karein — stock In apne aap ban jaata hai, alag se koi stock entry nahi karni.",
        ],
        notes: [
          "Adha maal aane par PO 'Partially Received' rehta hai, baaki maal aane par dobara yahi step karke poora kiya ja sakta hai.",
        ],
      },
    ],
  },

  {
    id: "leads",
    title: "Leads aur Quotation (Sales Pipeline)",
    description:
      "Lead punch/import se le kar Qualify, Follow-up, Meeting, Negotiation aur Quotation tak — poora sales pipeline. Quotation accept hote hi 'Order Confirmed' par ruk jaata hai — aage ka Order (Payment/Credit, Stock reserve, Dispatch commit) 'Order' chapter me hai.",
    sections: [
      {
        id: "leads-idea",
        title: "Lead FMS kaam kaise karta hai",
        audience: "LEAD_FMS",
        summary:
          "Har lead ek fixed pipeline se guzarta hai — New se le kar Order Confirmed (jeeta) ya Lost (haara) tak — aur har kadam ek activity ban kar us lead ki history me record hota hai.",
        how: [
          "Pipeline: New → Qualified (ya Junk, yahin khatam) → Follow-up (Call Back Later par yahin ruka rehta hai) → Meeting Scheduled (Reschedule par yahin ruka rehta hai) → Negotiation → Quotation Sent → Order Confirmed (jeeta) / Lost (kabhi bhi ho sakta hai).",
          "Lead ki detail dabate hi sirf usi stage ka relevant action dikhta hai — jaise New lead par sirf Qualify, Negotiation par Negotiation notes + Quotation banane ka button.",
          "Har action (Qualify, Follow-up, Meeting, Negotiation, Quotation, Won, Lost) turant us lead ki History me ek line ban kar dikhta hai — kisne, kab, kya kiya, sab ek jagah.",
        ],
        notes: [
          "Lost kabhi bhi, kisi bhi (khatam na hui) stage se ho sakta hai — reason likhna zaroori hai.",
          "'Call Back Later' aur 'Reschedule' loops hain — jab tak Doer khud aage nahi badhata, lead usi stage me ruki rehti hai, agli follow-up/meeting date ke saath.",
        ],
      },
      {
        id: "leads-punch",
        title: "Naya Lead Punch ya Import Karna",
        audience: "LEAD_FMS",
        summary: "Ek lead ka sirf naam hi kaafi hai shuru karne ke liye — baaki jo pata ho bhar dein.",
        steps: [
          "Leads page par '+ Naya Lead' dabayein — sirf Naam zaroori hai, Phone/Company/City/Product Interest sab optional hain.",
          "Bahut saare leads ek saath daalne ho (jaise exhibition ya IndiaMART se) to 'Bulk Upload' se template download karke Excel me bharein aur upload karein.",
        ],
        notes: [
          "Agar wahi naam-phone wala lead pehle se hai to ek warning dikhegi, lekin lead phir bhi ban jaayega — duplicate kabhi block nahi hota, sirf flag hota hai.",
        ],
      },
      {
        id: "leads-pipeline",
        title: "Pipeline ke har stage ka matlab",
        audience: "LEAD_FMS",
        summary: "Kaunsa button kab dabana hai, aur uska kya asar hota hai.",
        how: [
          "New: abhi-abhi aaya lead. Qualify dabakar 'Qualified' (aage badhaayein) ya 'Junk' (bekaar lead, yahin khatam) mark karein.",
          "Qualified/Follow-up: yahan 'Follow-up Log Karein' se Interested / Not Interested / Call Back Later mein se ek chunein — Call Back Later par agli date/time dena zaroori hai, lead usi stage me rukega. Isi stage se 'Meeting Schedule Karein' se meeting bhi tay ki ja sakti hai.",
          "Meeting Scheduled: meeting ke baad 'Meeting Outcome' me Done (Negotiation shuru) / Reschedule (nayi date) / Not Interested (Lost) chunein.",
          "Negotiation: requirement notes likh kar save karein (jitni baar chahe), aur jab tayyar ho 'Quotation Banayein' dabayein.",
          "Quotation Sent: quotation bhej diya gaya hai — customer ka jawab aane par Quotation page se hi Accept ya Reject karein.",
          "Order Confirmed / Lost: dono terminal hain — inme koi action nahi bacha, sirf summary dikhti hai.",
        ],
      },
      {
        id: "leads-quotation",
        title: "Quotation Banana, Bhejna aur Accept Karna",
        audience: "LEAD_FMS",
        summary: "Header, ek editable line-item grid (formula calculator ke saath), aur GST/Freight totals — sab ek hi page par.",
        steps: [
          "Lead ke Negotiation stage se 'Quotation Banayein' dabayein — party details, subject/note/terms Quotation Setup ke defaults se apne aap bhar jaate hain.",
          "Line items me Particular/Specification/Description/UOM bharein. Qty box me seedha number ya formula (jaise 2.5*3+1.2) likh kar bahar click karein — jawab khud aa jaayega, formula bhi saath me yaad rakha jaata hai.",
          "Rate bharte hi Amount khud ban jaata hai. Freight aur GST% daalte hi neeche Sub Total/GST/Payable turant update ho jaate hain.",
          "'Draft Save Karein' se jab chahe utni baar save karein. Tayyar hone par 'Bhej Dein (Send)' dabayein — isse pehle kam se kam ek line hona zaroori hai.",
          "Customer ka jawab aane par 'Accepted Mark Karein' (lead 'Order Confirmed' ho jaayega) ya 'Rejected Mark Karein' dabayein.",
          "'PDF Download' se kabhi bhi ek professional PDF quotation ban kar khulti hai — company/bank letterhead Quotation Setup se, logo Organization Logo se aata hai.",
        ],
        notes: [
          "Quotation Number (jaise QN-0001) ek series me apne aap milta hai — Admin Quotation Setup me prefix/starting number tay karta hai.",
          "Ek baar Accept ho jaane ke baad quotation edit nahi ho sakta — sirf PDF dobara download ho sakta hai.",
          "Quotation FMS ka kaam yahin khatam ho jaata hai — Order Confirmed hote hi lead ka status badalta hai, aur wahi Accepted quotation Order FMS ki apni Intake list me aa jaata hai (dekhein 'Order' chapter).",
        ],
      },
      {
        id: "leads-quotation-setup",
        title: "Quotation Setup",
        audience: "admin",
        summary: "Quotation PDF ka letterhead aur har naye quotation ke defaults ek baar set kar dein.",
        steps: [
          "Admin → Settings → Quotation — Setup section kholein.",
          "Company Name/Address/GSTIN aur Bank Details bharein — ye har PDF par letterhead ki tarah chhapte hain.",
          "Default Subject/Note/Terms & Conditions likhein — naya quotation banate hi ye khud bhar jaate hain (baad me har quotation par alag se badle bhi ja sakte hain).",
          "Default GST%, Quotation Valid For (kitne din) aur Number Prefix/Starting Number tay karein, Save karein.",
        ],
        notes: [
          "Organization Logo yahin se nahi, Settings ke Logo section se aata hai — do jagah alag se upload karne ki zaroorat nahi.",
        ],
      },
    ],
  },

  {
    id: "orders",
    title: "Order (Sales chain ka doosra hissa)",
    description:
      "Quotation Accept ho jaane ke baad, ya seedha Direct — payment/credit review, stock reserve aur dispatch commit tak. Yahan Order FMS ka kaam khatam hota hai; dispatch commit hote hi order PDI ke intake me chala jaata hai.",
    sections: [
      {
        id: "orders-idea",
        title: "Order FMS kaam kaise karta hai",
        audience: "ORDER_FMS",
        summary:
          "Ek order do tariko se ban sakta hai — Lead se (Quotation Accept hone ke baad) ya Direct (seedha Order page se) — aur dono ek hi aage ke safar me mil jaate hain.",
        how: [
          "Lead-sourced: koi Quotation Accept hoti hai to wo Order page ke 'Intake' tab me aa jaati hai. Usme har line ko ek real Item se map karna hota hai aur Customer Master confirm/naya banana hota hai — ye teeno kaam ek hi 'Map Karein' button se ek saath hote hain.",
          "Direct: '+ Naya Order' se seedha Customer chunein (ya naya banayein) aur Items/Qty/Rate bhar kar order bana dein — koi mapping nahi chahiye, kyunki shuru se hi real Items chuni ja rahi hain.",
          "Dono ke baad ka safar ek hi hai: Payment Review → (zaroorat pade to) Credit Hold → Stock Check → Dispatch Pending → Ready For PDI. Cancel kisi bhi (Ready For PDI se pehle wale) stage se ho sakta hai.",
          "Har action order ki History me ek line ban kar dikhta hai — order ek single status cell nahi, ek poori timeline hai.",
        ],
      },
      {
        id: "orders-payment-review",
        title: "Payment Review — advance ya credit check",
        audience: "ORDER_FMS",
        summary: "Har order 'Payment Review Chalayein' dabane par customer ki credit/advance position check karta hai.",
        how: [
          "Agar customer ko koi credit nahi diya gaya (Customer Master me Credit Limit aur Credit Days dono khaali hain), to aage badhne se pehle kam se kam ek advance payment record karna zaroori hai — 'Payment Record Karein' se koi bhi amount, kisi bhi stage par, record kiya ja sakta hai.",
          "Agar customer ko credit diya gaya hai, to system check karta hai: (a) is order ke saath customer ka total outstanding (sab open order milakar) Credit Limit se to nahi badh raha, aur (b) kya customer ka koi purana order Credit Days se zyada time se unpaid to nahi hai. Dono me se ek bhi sach hone par order 'Credit Hold' par chala jaata hai.",
          "Dono theek hain to order seedha 'Stock Check' me chala jaata hai.",
        ],
        notes: [
          "Outstanding hamesha taaza calculate hota hai — order value minus us order par ab tak jitna payment record hua hai, sab open (non-Cancelled) orders milakar. Kahin koi number store nahi hota.",
        ],
      },
      {
        id: "orders-credit-hold",
        title: "Credit Hold clear karna",
        audience: "ORDER_FMS",
        summary: "Credit Hold ek insaan ka faisla hai — system khud apna hold nahi hataata.",
        how: [
          "Sirf Admin → Settings → Order — Setup me chuna gaya 'Credit-Hold Approver' (ya koi Admin) hi order detail me 'Approve Karein' dabaakar Credit Hold clear kar sakta hai.",
          "Clear hote hi order 'Stock Check' me chala jaata hai, aur History me kisne/kab approve kiya, wo record ho jaata hai.",
        ],
      },
      {
        id: "orders-stock-check",
        title: "Stock Check — FG stock reserve hona aur shortage",
        audience: "ORDER_FMS",
        summary: "Order detail me 'Stock Check Chalayein' dabate hi jitna Free stock mile utna is order ke liye turant reserve ho jaata hai.",
        how: [
          "Har line ke liye jo bhi Free FG stock us waqt available hai, usme se jitna mil sake utna reserve kar diya jaata hai (poori qty ya jitni mile). Bacha hua hissa 'shortage' ban jaata hai.",
          "Reserve hone ke baad wo stock kisi doosre order ke liye Free nahi dikhta — Inventory page par bhi 'Free' isi hisab se kam dikhega, jaise ek production plan ka reserved raw material dikhta hai.",
          "Reservation koi ledger entry nahi banata — maal abhi dispatch nahi hua, sirf itna tay hua hai ki wo is order ke liye rakha hua hai.",
          "Poora reserve hone ke baad order 'Dispatch Pending' me chala jaata hai — shortage ho ya na ho, order aage badh jaata hai (shortage wale item baad me production se aa sakte hain).",
        ],
        notes: [
          "Kisi bhi line me shortage aane par PPC_PLAN access wale har user ko ek Task aur ek WhatsApp message turant chala jaata hai — production plan banane ki yaad dilane ke liye. Ye best-effort hai: WhatsApp na jaaye (phone na ho, ChatXFlow set na ho) to bhi stock reservation par koi asar nahi padta.",
        ],
      },
      {
        id: "orders-dispatch",
        title: "Dispatch Commit Date aur Ready For PDI",
        audience: "ORDER_FMS",
        summary: "Dispatch Pending order ke liye bas ek commit date daalni hai.",
        steps: [
          "Order detail me 'Dispatch Pending' stage par Date chunein aur 'Commit Karein' dabayein.",
          "Order 'Ready For PDI' ho jaata hai — Order FMS ka apna kaam yahin khatam ho jaata hai; aage PDI (Pre-Dispatch Inspection) me ye order intake queue me dikhne lagta hai.",
        ],
      },
      {
        id: "orders-cancel",
        title: "Order Cancel karna",
        audience: "ORDER_FMS",
        summary: "Ready For PDI se pehle kisi bhi stage se order cancel ho sakta hai.",
        steps: [
          "Order detail me 'Order Cancel Karein' dabayein, reason likhein (optional) aur confirm karein.",
        ],
        notes: [
          "Cancel hote hi is order ka koi bhi FG stock reservation turant chhoot jaata hai — wo stock doosre orders/plans ke liye Free ho jaata hai.",
        ],
      },
      {
        id: "orders-setup",
        title: "Order — Setup",
        audience: "admin",
        summary: "Har step ka Doer/TAT (jaankari ke liye) aur Credit-Hold Approver (jo asal me enforce hota hai) ek baar set kar dein.",
        steps: [
          "Admin → Settings → Order — Setup section kholein.",
          "Items Mapping/Payment Review/Stock Check/Dispatch Commit — chaaron ke liye Doer aur TAT bharein.",
          "'Credit-Hold Approver' me wo user chunein jo Credit Hold clear karne ka akela adhikari ho — ye kisi step ka Doer nahi, ek alag, khaas access hai.",
        ],
        notes: [
          "Doer/TAT sirf jaankari/planning ke liye hain — koi bhi ORDER_FMS access wala user kisi bhi order ka koi bhi step kaam kar sakta hai, jaise Purchase FMS me hota hai. Sirf Credit-Hold Approver hi asal me lock hai — sirf wahi user (ya Admin) Credit Hold clear kar sakta hai.",
        ],
      },
    ],
  },

  {
    id: "pdi",
    title: "PDI (Pre-Dispatch Inspection) — Sales chain ka teesra hissa",
    description:
      "Dispatch se pehle order ke goods inspect karna. Order 'Ready For PDI' hote hi yahan Intake me aa jaata hai; PDI Pass hote hi order TMS (Transport) aur Accounts (Invoice) — dono me alag-alag aage badh jaata hai. Dispatch (asal me truck rawana karna) abhi alag module nahi bana hai.",
    sections: [
      {
        id: "pdi-idea",
        title: "Waiting for Stock vs Ready to Inspect",
        audience: "PDI_FMS",
        summary:
          "Ek order jab Order FMS se 'Ready For PDI' hota hai, PDI ke Intake tab me candidate ban kar aa jaata hai — punch karte hi ek naya PDI inspection ban jaata hai, jo Pending se shuru hota hai.",
        how: [
          "'Waiting for Stock' ya 'Ready to Inspect' — ye do label kahin store nahi hote, har baar order ke apne items dekh kar taaza nikaale jaate hain: agar kisi bhi line ka shortage 0 se zyada hai, to 'Waiting for Stock'; warna 'Ready to Inspect'.",
          "Jab tak order 'Waiting for Stock' hai, Inspect action (Pass/Fail) diya hi nahi jaata — kyunki jo maal abhi tak aaya hi nahi, use inspect nahi kiya ja sakta.",
          "Naya FG stock aate hi (chahe production se, chahe manual stock-in se, chahe bulk import se) Order FMS khud-ba-khud is order ka bacha hua shortage clear karne ki koshish karta hai — koi manual 'recheck' button dabana nahi padta. Shortage clear hote hi PDI board apne aap agli baar khulte hi 'Ready to Inspect' dikhayega.",
        ],
        notes: [
          "Agar do orders ek hi SKU ke liye stock ka wait kar rahe hain aur utna stock nahi aata ki dono ka pura shortage clear ho jaaye, to jo order pehle bana tha (purana order) pehle poora satisfy kiya jaata hai, phir bacha hua stock naye order ke liye jaata hai.",
        ],
      },
      {
        id: "pdi-inspect",
        title: "Pass ya Fail record karna",
        audience: "PDI_FMS",
        summary: "Jab order 'Ready to Inspect' hai, uske detail me Pass ya Fail record kiya ja sakta hai — remark aur report attachment dono optional hain.",
        steps: [
          "PDI board me us inspection par click karein, order ke items (qty/reserved/short) dekh lein.",
          "Chahe to Remark likhein aur/ya report attach karein, phir 'Pass' ya 'Fail' dabayein.",
        ],
        notes: [
          "Pass karne par inspection 'Passed' ho jaati hai aur History me record ho jaata hai kisne/kab Pass kiya.",
          "Fail karne par inspection wahi ki wahi 'Pending' rehti hai — koi nayi inspection nahi banti, wahi ek dobara Pass/Fail ke liye khuli rehti hai. Fail ki wajah remark me likh dena madadgar hota hai, taaki dobara inspect karne wale ko pata rahe kya theek karna hai.",
        ],
      },
    ],
  },

  {
    id: "tms",
    title: "TMS (Transport) — Sales chain ka chautha hissa",
    description:
      "PDI Pass hote hi order yahan aata hai — vehicle/truck arrange karna aur uski Loading Dock confirmation record karna. Ek order 'Self' (hum khud arrange karte hain, Freight Paid) ya 'Party' (customer khud pickup arrange karta hai, To Pay) me se ek tareeke se chalta hai — ye decide Order banate waqt hi ho jaata hai.",
    sections: [
      {
        id: "tms-idea",
        title: "Self vs Party, aur 'Fully Shipped' ka matlab",
        audience: "TMS_FMS",
        summary:
          "Har naya Order ab Order Form me hi bataata hai ki uska transport kaun arrange karega — Self ya Party. Yahi decide karta hai TMS me us order ke saath kya hota hai.",
        how: [
          "Self (Freight Paid): hum khud Transport Vendor, vehicle size aur freight price chun kar shipment plan karte hain.",
          "Party (To Pay): customer khud apna vehicle bhej raha hai — hume sirf 'expect' karna hai, jab tak wo aaye Follow Up kar sakte hain, aur aane par Loading Dock confirm karna hai. Vendor/vehicle price yahan lagta hi nahi.",
          "Ek order 'Fully Shipped' tab kehlaata hai jab uski har line ki poori quantity kisi-na-kisi shipment me allocate ho chuki ho — ye kahin store nahi hota, har baar taaza jod kar nikaala jaata hai. Ek order me ek se zyada shipment (jaise do truck) lag sakte hain.",
        ],
        notes: [
          "Agar koi Order is column ke bane se pehle ka hai (isliye Self/Party set hi nahi hai), to TMS ke Intake me wo 'Decision Chahiye' dikhega — pehle transport arrangement set karna hoga, tabhi shipment plan ho payegi.",
        ],
      },
      {
        id: "tms-plan",
        title: "Shipment Plan karna aur Loading Dock Confirm karna",
        audience: "TMS_FMS",
        summary: "Candidate order kholkar shipment plan karein, phir jab truck aa jaaye tab Loading Dock confirm karein.",
        steps: [
          "TMS board ke 'Candidates' tab me order par click karein.",
          "Self ho to Transport Vendor, Vehicle Size, Freight Price bharein; Party ho to seedha aage badhein.",
          "From Warehouse/To Address bharein (To Address order ke shipping address se pehle se bhara aata hai, chahen to badal sakte hain), aur jo lines is shipment me jaa rahi hain unki quantity dein — default me poori bachi hui quantity bhari hoti hai, kam bhi kar sakte hain agar sirf ek hissa jaa raha hai.",
          "'Shipment Plan Karein' dabate hi shipment 'Pending' status me ban jaati hai.",
          "Jab truck actually aa jaaye, us shipment par 'Loading Dock Confirm Karein' dabayein — Vehicle No./Driver Contact No. yahi par bhi de sakte hain agar pehle nahi diya tha.",
        ],
        notes: [
          "Party-arranged shipment me 'Follow Up' ek simple reminder hai — koi field nahi badalta, bas ek note History me chala jaata hai ki truck abhi tak nahi aaya.",
          "Ek order ke liye kai shipment lagana bilkul theek hai — jaise ek bada order do truck me jaaye, to do baar shipment plan karke har truck me alag-alag lines/quantity dena.",
        ],
      },
      {
        id: "tms-vendors",
        title: "Transport Vendor Master",
        audience: "TMS_FMS",
        summary: "Transport Vendors ka apna chhota master hai — Purchase Vendor se alag, TMS ke apne board ke andar hi 'Vendors' tab me.",
        steps: [
          "TMS board ke 'Vendors' tab me '+ Add Transport Vendor' se ek-ek karke add karein, ya 'Bulk Upload' se template download karke Excel/CSV se ek saath kai vendor daalein.",
        ],
      },
    ],
  },

  {
    id: "accounts",
    title: "Accounts — Invoice (Receivables)",
    description:
      "Ek order ke liye Invoice banana aur Issue karna — Invoice No., E-way Bill aur documents ke saath. Ye poore Accounts module ka sirf pehla, chhota hissa hai — GL, aging jaisi badi cheezein abhi nahi bani hain.",
    sections: [
      {
        id: "accounts-idea",
        title: "Ek Order, Ek Invoice",
        audience: "ACCOUNTS_FMS",
        summary: "PDI Pass hote hi order Accounts ke 'Needs Invoicing' tab me aa jaata hai, jab tak uski Invoice na ban jaaye.",
        how: [
          "Har order ki sirf ek hi Invoice ban sakti hai — dobara banane ki koshish rok di jaati hai.",
          "Invoice banate waqt 'Final Value' apne aap suggest hota hai: Order Value, aur agar transport 'Self' se arrange hua hai to us order ki saari shipments ka freight bhi jud kar. Party-arranged order me freight kabhi nahi judta — wo customer ka apna kharch hai.",
          "Ye suggested value sirf ek suggestion hai — save karne se pehle chahen to badal sakte hain.",
        ],
      },
      {
        id: "accounts-issue",
        title: "Draft banana aur Issue karna",
        audience: "ACCOUNTS_FMS",
        summary: "Invoice pehle Draft banti hai — jab asli document/number taiyaar ho jaaye, tab Issue karein.",
        steps: [
          "'Needs Invoicing' se order chunkar 'Invoice Banayein' dabayein — Final Value check/badal kar save karein. Baaki sab (Invoice No., documents, E-way Bill) Draft me optional hain.",
          "Jab Invoice No. mil jaaye aur Invoice Document attach ho jaaye, Draft khol kar bhar dein, phir 'Issue Karein' dabayein.",
        ],
        notes: [
          "Issue karne ke liye Invoice No. aur Invoice Document dono zaroori hain — E-way Bill hamesha optional hai (har dispatch me E-way Bill nahi lagta).",
          "Ek baar Issue ho jaane ke baad Invoice edit nahi hoti — ek asal business document hai, isliye ban jaane ke baad usme badlaav nahi hota.",
          "Invoice detail me 'Invoiced' aur 'Received' dono dikhte hain — 'Received' Order FMS ke apne payments se seedha padha jaata hai, Accounts khud koi doosra payment record nahi rakhta.",
        ],
      },
    ],
  },

  {
    id: "dispatch",
    title: "Dispatch — Sales chain ka paanchwa aur aakhri hissa",
    description:
      "Shipment jab TMS me Loading Dock par confirm ho jaati hai (aur order ka Invoice bhi Issue ho chuka hota hai), tab wo Dispatch me aa jaati hai — Gate Pass issue karke asal stock dispatch karna, phir Mark Dispatched karke shipment band karna. Ye poori Sales chain (Lead → Order → PDI → TMS → Dispatch) ka aakhri kadam hai.",
    sections: [
      {
        id: "dispatch-idea",
        title: "Gate Pass aur asal stock dispatch",
        audience: "DISPATCH_FMS",
        summary:
          "Dispatch board ke 'Candidates' tab me har wo shipment dikhti hai jo Loading Dock par confirm ho chuki hai lekin abhi Dispatch nahi hui — jab tak order ka Invoice Issue nahi hota, candidate 'Invoice Ka Wait Hai' dikhata hai.",
        how: [
          "Candidate par click karke 'Dispatch Confirm Karein' kholein — ek sequential Gate Pass number (jaise GP-0001) apne aap ban jaata hai.",
          "Yahi par asal stock bhi nikal jaata hai — shipment me jo bhi item/quantity hai, uska ek real 'Out' entry Stock Ledger me likha jaata hai. Ye kabhi best-effort nahi hai: agar kisi wajah se stock genuinely kam pad jaaye, to poora Confirm Dispatch fail ho jaata hai aur kuch bhi adhoora save nahi hota.",
          "Isi waqt ek Assignee (jo is shipment ko track karega) aur TAT (Value + Unit — Minutes/Hours/Days) diya jaata hai — deadline us assignee ke apne working-hours calendar se nikaali jaati hai, bilkul waise hi jaise FMS steps me hota hai. Ye TAT Purchase/Order Setup jaisi fixed org-wide setting nahi hai — har shipment ke liye alag se yahin diya jaata hai.",
          "Gate Pass ka attachment (jaise scanned copy) optional hai.",
        ],
        notes: [
          "Ek order ke kai shipments ho sakte hain (jaise do truck) — har shipment ka apna alag Gate Pass aur apna alag Confirm/Mark Dispatched lifecycle chalta hai.",
        ],
      },
      {
        id: "dispatch-mark",
        title: "Mark Dispatched — shipment band karna",
        audience: "DISPATCH_FMS",
        summary:
          "Jab truck asal me nikal jaaye, us shipment ko 'In Transit' se 'Dispatched' me le jaayein — ye assigned user khud kar sakta hai, ya Dispatch access wala koi bhi user.",
        steps: [
          "'In Transit' tab me shipment par click karein.",
          "Chahe to 'Proof of Dispatch' attach karein (jaise signed LR ya transporter ki confirmation slip) — ye customer tak maal pahunchne ka proof nahi hai, sirf itna proof hai ki truck nikal gaya.",
          "'Mark Dispatched' dabayein.",
        ],
        notes: [
          "Jab order ke saare shipments 'Dispatched' ho jaate hain, wo order 'Order Poora Dispatch Ho Gaya' dikhta hai — yehi poori Sales chain (Lead se lekar Dispatch tak) ka asli, aakhri padaav hai. Isse aage koi module is order ko nahi le jaata.",
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
          "Naye product ki BOM banate hi uska Item bhi khud-ba-khud Inventory → Finished Goods me ban jaata hai (Category FG, unit PCS) — agar wo pehle se maujood nahi tha. Isse production complete hone par FG stock likhne me kabhi rukawat nahi aati. Lead Time, Max Level jaise planning number abhi bhi khaali rehte hain — wo baad me Item ke andar ja kar bhar sakte hain.",
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
          "Chahein to Order No (jaise customer ka PO number) aur Production Line daal dein.",
          "Material check karein dabakar dekhein kis product ka kya material kam pad raha hai.",
          "Plan banayein dabayein.",
        ],
        notes: [
          "'Material check karein' sirf dikhata hai, kuch likhta nahi. Wo wahi hisaab chalata hai jo asli plan banane par chalega, isliye jo dikha wahi hoga.",
          "Sirf un product ka plan ban sakta hai jinki active BOM maujood hai.",
          "Har product apna alag plan banta hai, kyunki production, shuruaat aur completion har product ki apni hoti hai. Par material sabko ek saath baanta jaata hai.",
          "Har plan ko ek Job No khud-ba-khud mil jaata hai (paperwork ke liye) — Order No khud likhna hota hai, kisi cheez se match nahi karta, sirf record ke liye hai.",
          "Production Line chunna optional hai — ye wahi FMS Template hai jo is product ka multi-step process chalata hai (jaise Winding se lekar Dispatch tak). Jo Line chunenge, Production shuru dabane par sirf wahi Line is plan ke liye start hogi, koi doosri Line isse touch nahi karegi.",
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
        id: "users",
        title: "Users banana aur access dena",
        audience: "admin",
        summary:
          "Har user ko banate waqt tay karein ki wo system ke kaun se hisse me kaam karega.",
        steps: [
          "Admin → Users → Add User.",
          "Naam, email, password, role, department aur WhatsApp number daalein.",
          "Reporting Manager chunein — Leave System me isi user ki approval chain me 'Reporting Manager' step yahi resolve karta hai.",
          "System Access me wahi modules tick karein jo us user ko chahiye.",
          "Create karein — aur password user ko bhej dein.",
        ],
        notes: [
          "Role aur access do alag cheezein hain. Role batata hai ki wo Admin hai ya nahi; access batata hai ki wo kis module me kaam karega. Kisi ko task assign karne dene ke liye ab use Admin banane ki zaroorat nahi — bas wo checkbox tick kar dein.",
          "Admin ke paas har module ka access apne aap hota hai.",
          "Jo modules aap tick karenge, wahi us user ke dashboard par tabs banke dikhenge.",
          "Password bhool jaane par Manage → Reset Password se naya banayein. Purana kabhi dekha nahi ja sakta.",
          "WhatsApp number ke shuru me country code (91) hona chahiye, ya 10-digit Indian mobile daalein — system khud 91 laga deta hai agar bhoole se na daalein. Bina iske WhatsApp messages kabhi nahi pahunchte.",
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
        id: "holidays",
        title: "Holiday List banana",
        audience: "admin",
        summary:
          "In dates par koi bhi Recurring Task, FMS ya IQC deadline nahi ginti — weekly-off (Sunday, FMS Shifts me set) ke alawa ye extra non-working days hain.",
        steps: [
          "Admin → Settings → Holiday List kholein.",
          "Ek-ek karke add karna ho to Date aur (optional) naam bhar kar Add dabayein.",
          "Bahut si dates ek saath daalni ho to upar 'Import' se template download karein, bhar kar upload karein.",
          "Kisi bhi holiday ka naam seedhe table me badal kar Save kar sakte hain, ya 'Hatayein' se poora hata sakte hain.",
        ],
        notes: [
          "Ek hi date do baar add karne par purani wahi date update ho jaati hai, dobara nahi banti.",
          "Sunday ka skip alag se kahin nahi likhna — wo FMS Shifts ke weekly-off se khud aata hai. Holiday List sirf usse alawa ki extra dates ke liye hai (jaise Diwali, kisi khaas chhutti ke din).",
        ],
      },
      {
        id: "troubleshooting",
        title: "Kuch kaam na kare to",
        audience: "admin",
        summary: "Aam dikkatein aur unka pehla ilaaj.",
        notes: [
          "User login nahi kar pa raha — password kahin se copy mat karwayein (sirf uska encrypted hash store hota hai). Reset Password se naya dein.",
          "User ko koi tab nahi dikh raha — uske System Access me kuch tick nahi hua hai.",
          "WhatsApp nahi ja raha — Settings me Send Test Message se check karein, phir ChatXFlow ka session dekhein.",
        ],
      },
    ],
  },

  {
    id: "leave",
    title: "Leave System (Buddy System)",
    description:
      "Leave file karne se lekar buddy ke naam kaam chale jaane tak — poore system me leave ka intezaam.",
    sections: [
      {
        id: "leave-idea",
        title: "Buddy system kaam kaise karta hai",
        audience: "everyone",
        summary:
          "Jab koi Doer leave par jaata hai, uske Reporting Manager (ya Admin ne jo bhi tay kiya ho) se approval leni hoti hai. Approve hote hi, leave ke jitne din hain unme uska pending kaam apne chune hue Buddy ke naam chala jaata hai — khud-ba-khud, khatam hote hi wapas.",
        how: [
          "Leave file karte waqt Doer khud apna Buddy chunta hai — koi doosra chun nahi sakta, kyunki Doer hi jaanta hai ki uska kaam sabse sahi kisko samajhaya jaa sakta hai.",
          "Approval single ho sakta hai ya multi-step — Admin ne Settings me jaisa chain banaya ho (jaise: pehle Reporting Manager, phir HR). Har org apni zaroorat ke hisaab se ye chain khud tay karta hai.",
          "Sirf poori tarah Approved leave par hi reassignment hota hai. Jab tak koi step Pending hai, Doer ka kaam usi ke paas rehta hai.",
          "Leave shuru hote hi (ya turant, agar leave aaj hi shuru ho rahi hai) Doer ke jitne Tasks aur FMS steps abhi Pending hain, sab Buddy ke naam ho jaate hain. Leave khatam hote hi — jo abhi bhi Pending hai aur abhi bhi Buddy ke paas hai, wahi wapas Doer ke naam aata hai.",
          "Jo kaam Buddy ne leave ke dauraan khud complete kar diya, wo wapas nahi jaata — kyunki wo ho chuka hai, Buddy ke naam se hi record rahega.",
        ],
        notes: [
          "V1 me leave balance/quota ka hisaab nahi rakha jaata — sirf approval aur reassignment. Kitni leave bachi hai, ye abhi track nahi hota.",
          "Buddy ke apne kaam ke saath Doer ka kaam bhi jud jaata hai — dono ek hi jagah (Tasks/FMS page par) dikhte hain, alag se kahin dhoondhna nahi padta.",
        ],
      },
      {
        id: "leave-apply",
        title: "Apni leave apply karna",
        audience: "everyone",
        summary: "Leave page se apni leave file karein.",
        steps: [
          "Leave page → 'Leave ke liye Apply karein' dabayein.",
          "Leave Type chunein (Casual/Sick/Earned/Other), Start aur End Date daalein.",
          "Buddy chunein — koi bhi active user, khud ko chhod kar.",
          "Reason likhein aur Apply karein dabayein.",
        ],
        notes: [
          "Approval chain khaali ho (Admin ne kuch set na kiya ho) to leave turant Approved ban jaati hai — kisi ke wait ki zaroorat nahi.",
          "Leave abhi Pending ya Approved hai to use Cancel bhi kiya ja sakta hai — Cancel karne par agar reassignment ho chuka tha, wo turant wapas ho jaata hai.",
        ],
      },
      {
        id: "leave-approve",
        title: "Kisi ki leave approve/reject karna",
        audience: "everyone",
        summary:
          "Jinki leave approval chain me aap ek step hain, unki request 'Approvals' tab me aapko dikhti hai.",
        steps: [
          "Leave page → Approvals tab kholein.",
          "Jis request par decision lena hai, Reason padhein, remark likhein (optional).",
          "Approve ya Reject dabayein.",
        ],
        notes: [
          "Multi-step chain me ek step Approve karne se agla step us next approver ko dikhne lagta hai — sab steps Approve hone ke baad hi leave 'Approved' banti hai.",
          "Kisi ek step par Reject hote hi poori leave 'Rejected' ho jaati hai, aage koi step nahi chalta.",
        ],
      },
      {
        id: "leave-emergency",
        title: "Emergency Leave — HR dwara file karna",
        audience: "LEAVE_HR",
        summary:
          "Jab Doer khud leave file nahi kar sakta (achanak emergency), HR uske liye file kar sakta hai — Doer aur Buddy dono HR khud chunta hai.",
        steps: [
          "Leave page → 'Emergency Leave File Karein' dabayein.",
          "Doer chunein jiske liye file kar rahe hain.",
          "Leave Type, Buddy, Start/End Date aur Reason bharein.",
          "File karein dabayein.",
        ],
        notes: [
          "Iske aage ka approval aur reassignment bilkul normal leave jaisa hi chalta hai — sirf filing HR ne ki, baaki sab wahi flow.",
        ],
      },
      {
        id: "leave-approval-setup",
        title: "Approval chain set karna",
        audience: "admin",
        summary:
          "Admin → Settings → Leave Approval Setup me tay karein leave approve karne se pehle kis-kis se, kis order me approval chahiye.",
        steps: [
          "Admin → Settings → Leave — Approval Setup kholein.",
          "'Ek aur step' dabakar step jodein.",
          "Har step ke liye chunein — 'Reporting Manager' (har Doer ke apne Reporting Manager se, jo unki User profile me set hai) ya 'Specific person' (hamesha wahi ek fixed user, jaise HR ya MD).",
          "Steps ka order upar-neeche arrow se badal sakte hain. Save karein.",
        ],
        notes: [
          "Koi step na ho (khaali chain) to sab leave turant Approved ban jaati hain — koi approval ka wait nahi hota.",
          "'Reporting Manager' step tab hi kaam karega jab Doer ki apni profile me Reporting Manager set ho (Users banate/badalte waqt) — na ho to ye step us Doer ke liye khud skip ho jaata hai.",
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
          "Wo /signup par jaakar organization ka naam, apna admin account aur (chahein to) logo daalta hai.",
          "System organization register karta hai, use Admin bana kar login kara deta hai — bas itna hi, kuch aur connect karne ki zaroorat nahi.",
        ],
        notes: [
          "Ek email poore platform par ek hi baar ban sakta hai — login sirf email maangta hai, isliye wo unique hona zaroori hai.",
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
          "Data aur users kuch bhi delete nahi hota — switch wapas on karte hi sab pehle jaisa chalne lagta hai.",
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
          "Ek hi record ko do log theek ek hi samay par edit karein to ek ka badlaav dab sakta hai. Alag-alag log apna-apna kaam karein to koi dikkat nahi.",
          "File upload ab seedhe browser se storage me jaati hai, isliye badi video/photo files bhi chal jaati hain.",
          "Automated kaam din me ek baar chalte hain.",
        ],
      },
    ],
  },

  {
    id: "fms",
    title: "FMS — multi-step process",
    description: "Ek se zyada steps wala kaam, jisme har step ki apni deadline aur apna aadmi hota hai.",
    sections: [
      {
        id: "fms-idea",
        title: "FMS kaam kaise karta hai",
        audience: "everyone",
        summary:
          "Ek FMS ek template se banta hai jisme kai steps hote hain — har step ek user ko assign hota hai aur har step ki apni turnaround time (TAT) hoti hai.",
        how: [
          "Jaise hi koi step aapko assign hota hai, uski deadline shuru ho jaati hai. Deadline sirf company ke working hours ke andar ginti hai — raat, lunch, tea break, weekly-off aur holiday ka time is ginti me nahi aata.",
          "Deadline ke andar complete kiya to 'On Time'. Deadline ke baad complete kiya to 'Delay Done'. Abhi tak pending hai aur deadline nikal chuki hai to 'Not Done' dikhta hai — ye bhi kahin store nahi hota, MIS score jaisa hi hamesha live nikala jaata hai.",
          "Agar aapke paas pehle se koi step khula (pending) hai aur usi waqt aapko doosra step assign ho raha hai, to naye step ki deadline aapke pehle wale step ke khatam hone ke baad se shuru hogi — ek waqt me ek hi step ka clock chalta hai.",
        ],
        notes: [
          "Ek step ka outcome (jaise Pass/Fail) decide karta hai ki agla kaunsa step chalega — sabke liye agla step ek jaisa nahi hota.",
        ],
      },
      {
        id: "fms-complete",
        title: "Apna step complete karna",
        audience: "everyone",
        summary: "FMS page par apne pending steps dekhein aur complete karein.",
        steps: [
          "FMS page kholein — apne naam assign saare pending steps yahan dikhte hain.",
          "Jis step ka kaam ho gaya, uske saamne Complete dabayein.",
          "Outcome chunein (jaise Pass ya Fail) aur chahen to remark likhein.",
        ],
      },
      {
        id: "fms-dashboard-history",
        title: "Dashboard par steps, MIS score, aur History",
        audience: "everyone",
        summary:
          "Aapke pending FMS steps ab Dashboard par bhi dikhte hain — sirf FMS page par nahi — aur unka TAT aapke MIS score me bhi ginta hai.",
        how: [
          "Jaise hi koi step assign hota hai (jaise Production Line ka Step 1, plan start hote hi), wo turant aapke Dashboard par dikhne lagta hai — Overview tab me 'FMS Steps' card ke andar.",
          "Complete karne ke baad bhi wo step us din working hours khatam hone tak Dashboard par dikhta rehta hai — turant gayab nahi hota. Agle din wo History me chala jaata hai.",
          "Har step ka Outcome (On Time / Delay Done / Not Done) aapke ek hi MIS score me ginta hai — Tasks aur FMS dono ek saath, alag-alag score nahi.",
        ],
        notes: [
          "Aapka MIS score kaise bana, ye Dashboard ke 'Aapka score' tab me line-by-line dikhta hai — Task aur FMS dono rows ek hi table me, FMS wali row ke aage '(FMS)' likha hota hai.",
          "FMS page ke 'History' tab me har complete hua step Doer, Job No, Order No aur Product ke saath dikhta hai — kisne, kab, kya kiya, sab ek jagah. Sirf apna history dikhta hai, jab tak Team Performance dekhne ka access na ho.",
        ],
      },
      {
        id: "fms-shifts",
        title: "Company Running Time set karna",
        audience: "FMS_ADMIN",
        summary:
          "Settings me shift ke ghante, lunch, tea (optional) aur weekly-off set karna — isi se har step ki deadline nikalti hai.",
        how: [
          "Har user ki apni shift hoti hai (User banate/badalte waqt). Ek shift ke start-end, lunch aur (agar ho to) tea break set karne se us shift ke logon ki TAT sahi ginti hai.",
          "Weekly-off (default Sunday) us din har naye step ki deadline aage badha deta hai. Kisi khaas date ko kholna ho — jaise ek Sunday production chalani ho — to Settings me Week-off Override daalein: sabke liye, ek Department ke liye, ya ek user ke liye.",
        ],
        notes: [
          "Shift/lunch/tea/weekly-off badalne ka asar sirf aage banne wale steps par padta hai — jo step pehle se chal raha hai uski deadline nahi badalti.",
        ],
      },
      {
        id: "fms-template",
        title: "Naya FMS Template banana",
        audience: "FMS_ADMIN",
        summary: "Ek multi-step process ko ek baar define karna — phir wo baar-baar chal sakta hai.",
        steps: [
          "FMS page ke Templates tab me 'Naya FMS Template' dabayein.",
          "Har step ka naam, kise assign hoga, aur TAT (Minutes, Hours ya Days me) bharein.",
          "Step ka Outcome Type chunein — Done, Pass aur Fail, Pass/Fail/Scrap Qty, Number, Text, Attachment, ya Custom (khud outcomes typing karein). Phir har outcome ke aage decide karein agla kaunsa step chalega, ya FMS yahin khatam ho.",
          "Template banayein dabayein.",
        ],
        notes: [
          "Trigger 'MANUAL' rakhne par FMS sirf haath se start hota hai. Iski jagah kisi module ka event key (jaise INWARD_ENTRY_CREATED) ya kisi doosre FMS template ka outcome key dene se wo FMS uske hote hi khud shuru ho jaata hai — koi loop na bane iska dhyan template banate waqt khud rakhna hai.",
          "Template Archive karne se uske purane chal rahe steps par asar nahi padta, sirf naye instance us se nahi bante. Ek Archived template jise koi step abhi chala hi nahi raha, use Templates list se permanently Delete bhi kiya ja sakta hai.",
          "'Pass/Fail/Scrap Qty' wale step me quantity khud aage badhti hai: 100 me se 98 Pass, 2 Fail kiye to 98 agle step pe chali jaati hai, aur 2 usi step pe usi doer ke paas ek naya pending kaam ban jaati hai — wo unhe dobara Pass/Fail kar sakta hai (jab tak resolve na ho), ya Scrap Qty likh kar unhe hamesha ke liye hata sakta hai. Final step ka stock sirf utni hi quantity se banta hai jitni sach me aakhir tak pahunchi.",
          "Kisi bhi step ki deadline TAT box me fix number likhne ke bajaye kisi pehle step ke field se bhi nikal sakti hai — 'Deadline pichle step ke field se nikaale' tick karke us step aur field ko chunein, aur ek offset (+/-) daalein. Jaise Purchase FMS me: Step 1 me 'Lead Days' bhara (jaise 10), Step 2 'Follow Up' ka offset -1 (deadline 9 din), Step 3 'Material Received' ka offset 0 (deadline 10 din) — ek hi number se dono deadlines ban jaati hain.",
          "Trigger 'INDENT_APPROVED' dene se wo FMS tab khud shuru hota hai jab koi indent Approve hota hai — isi se Purchase FMS banti hai: Vendor Details, Per Item Price, aur PO Attachment ek Form ke fields hain (Attachment type PO ke liye), Lead Days ek Number field hai.",
        ],
      },
    ],
  },
];

/**
 * Everything a viewer with these grants is meant to read, empty chapters dropped.
 *
 * The English guidebook is a parallel structure rather than a set of dictionary lookups:
 * a paragraph makes a brittle key, and prose is translated far more reliably with its
 * section visible around it. Both files carry the same ids, which `npm run i18n:check`
 * verifies.
 */
export function guideFor(options: {
  role: string;
  access: readonly string[];
  isPlatformAdmin: boolean;
  locale?: Locale;
}): GuideChapter[] {
  const source = options.locale === "hi" ? GUIDE : GUIDE_EN;
  const isAdmin = options.role === "Admin";
  // An Admin holds every module grant implicitly; be explicit so the guide never hides
  // a module's instructions from the person expected to explain it to their team.
  const grants = new Set<string>(isAdmin ? MODULE_ACCESS_KEYS : options.access);

  return source.map((chapter) => ({
    ...chapter,
    sections: chapter.sections.filter((section) => {
      if (section.audience === "everyone") return true;
      if (section.audience === "admin") return isAdmin;
      if (section.audience === "platform") return options.isPlatformAdmin;
      return grants.has(section.audience);
    }),
  })).filter((chapter) => chapter.sections.length > 0);
}
