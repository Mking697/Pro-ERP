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
  /** Ordered instructions, when the section is something you *do*. */
  steps?: string[];
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
          "Ye aapke organization ka kaam-kaaj sambhalne wala system hai — task delegation, recurring kaam, material inward aur quality check, aur sabki performance scoring. Saara data aapke organization ke apne Google Sheets me rehta hai; Pro ERP usi ko padhta-likhta hai.",
        notes: [
          "Aapko jo modules dikhte hain wo aapke Admin ne aapko diye hain. Kisi doosre organization ka data aapko kabhi nahi dikhega.",
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
        steps: [
          "Due date se pehle complete kiya = koi penalty nahi.",
          "Due date ke baad complete kiya = aadhi penalty.",
          "Due date nikal gayi aur task abhi bhi pending = poori penalty.",
          "Score = − (kul penalty ÷ kitne evaluate hue) × 100.",
        ],
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
          "Us folder ke andar blank sheets banayein: Tasks, Recurring Tasks, Holiday List, Inward & IQC FMS, Failure Log, IMS Inward.",
          "Folder share hone se andar ki saari sheets ko access mil jaata hai — har sheet alag se share karne ki zaroorat nahi.",
          "Admin → Settings me har module ke saamne uska URL paste karke Save karein.",
        ],
        notes: [
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
