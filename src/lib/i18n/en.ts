/**
 * English strings, keyed by the Hinglish original.
 *
 * A key that does not exactly match a string in the source does nothing — it cannot be
 * looked up — so `npm run i18n:check` compares this file against the strings actually
 * wrapped in `t()` and reports both directions.
 *
 * Strings already in English, proper nouns, example placeholders and unit labels
 * (SKU, UOM, ADC, ROP, PCS) are deliberately absent: they read the same either way.
 */
export const EN: Record<string, string> = {
  // --- shell, nav, auth ------------------------------------------------------------
  "Mera kaam": "My work",
  "Apna system shuru karein": "Set up your system",
  "Apne organization ka Pro ERP shuru karein": "Start Pro ERP for your organization",
  "Ek minute me aapka apna system taiyaar ho jaayega.": "Your own system will be ready in a minute.",
  "Apna email aur password daalein.": "Enter your email and password.",
  "Login karein": "Sign in",
  "Naya password": "New password",
  "Password kam se kam 6 characters ka ho.": "Password must be at least 6 characters.",
  "Kam se kam 8 characters": "At least 8 characters",
  "Kuch galat ho gaya. Dobara try karein.": "Something went wrong. Please try again.",
  "Dashboard pe jayein": "Go to dashboard",
  "Guidebook kholein": "Open the guidebook",
  "Kaise use karein": "How to use this",
  "Pehle ye kar lein": "Do this first",
  "Setup poora karein": "Finish setup",

  // --- dashboard -------------------------------------------------------------------
  "Aapke modules": "Your modules",
  "Aapka score kaise bana": "How your score was calculated",
  "Aapke paas koi pending task nahi hai.": "You have no pending tasks.",
  "Apne tasks dekhein aur, agar authorized hain, naye tasks assign karein.":
    "See your tasks and, if you are authorized, assign new ones.",
  "Abhi tak koi task evaluate nahi hua, isliye score nahi bana.":
    "No task has been evaluated yet, so there is no score.",
  "MIS score timestamps se calculate hota hai.":
    "The MIS score is calculated from timestamps.",
  "Har user ka score": "Every person's score",
  "Team ka batwara": "Team breakdown",
  "Result ka batwara": "Result breakdown",
  "Kisko kitne tasks diye": "Tasks assigned, by person",
  "Tasks kab bane": "When tasks were created",
  "Entries kab aayi": "When entries arrived",
  "Stock ka safar": "Stock movement",
  "Stock kab aaya": "When stock arrived",
  "Priority ke hisaab se": "By priority",
  "Frequency ke hisaab se": "By frequency",
  "Party ke hisaab se accepted qty": "Accepted quantity by party",
  "Pass vs Fail quantity": "Pass vs fail quantity",
  "Active vs Paused": "Active vs paused",
  "Rejection ke kaaran": "Reasons for rejection",
  "Saare tasks dekhein": "See all tasks",

  // --- tasks -----------------------------------------------------------------------
  "Naya Task Assign Karein": "Assign a new task",
  "Naya Recurring Task": "New recurring task",
  "Task assign ho gaya.": "Task assigned.",
  "Task complete ho gaya.": "Task completed.",
  "Recurring task assign ho gaya.": "Recurring task created.",
  "Ab is rule ke occurrences roz apne-aap generate hongi.":
    "This rule's occurrences will now be generated automatically each day.",
  "Koi pending task nahi hai.": "No pending tasks.",
  "Koi task assign nahi hua.": "No tasks have been assigned.",
  "Aapne abhi tak koi task assign nahi kiya.": "You have not assigned any tasks yet.",
  "Jo tasks aapne doosron ko diye.": "Tasks you assigned to other people.",
  "Repeating rules aur unki haalat.": "Repeating rules and their state.",
  "Doer select karein": "Select a doer",
  "Pehle ek Doer select karein.": "Select a doer first.",
  "Pehle ek user select karein.": "Select a user first.",
  "User select karein": "Select a user",
  "Kisko diya": "Assigned to",
  "Tasks load ho rahe hain": "Loading tasks",
  "Tasks load nahi ho paye.": "Could not load tasks.",
  "Recurring rules load nahi ho paye.": "Could not load recurring rules.",
  "Rules load ho rahe hain": "Loading rules",
  "Completion Proof (optional)": "Completion proof (optional)",
  "Completion due": "Due",

  // --- inventory -------------------------------------------------------------------
  "Naya Item": "New item",
  "Item ban nahi paya.": "Could not create the item.",
  "Item ya SKU search karein...": "Search by name or SKU...",
  "Item ya SKU...": "Name or SKU...",
  "Koi item nahi mila.": "No item found.",
  "Abhi koi item nahi hai": "No items yet",
  "Abhi koi movement nahi hui.": "No movements yet.",
  "Items load ho rahe hain": "Loading items",
  "Items load nahi ho paye.": "Could not load items.",
  "Inventory kholein": "Open Inventory",
  "product ki BOM ban chuki hai lekin unka Item abhi FG me nahi hai — production complete hone par inki FG stock write nahi ho paayegi, jab tak ye add na ho jaayein.":
    "product(s) have a BOM but no matching Item in FG yet — their FG stock write will keep failing on production completion until these are added.",
  "Iska FG Item nahi bana": "Its FG item hasn't been created",
  "Chunein": "Select",
  "+ FG Banayein": "+ Create FG",
  "FG Items Bulk Import Karein": "Bulk Import FG Items",
  "Template download karein, usi format me apna data bharein, phir upload karein — Category column me chahe kuch bhi likhein, sab items":
    "Download the template, fill in your data in the same format, then upload it — whatever you type in the Category column, every item created this way will become",
  "category ke ban jaayenge. Opening Stock column me kuch likhenge to us item ka stock bhi turant record ho jaayega.":
    "category. Fill in the Opening Stock column and that item's stock is recorded immediately too.",
  "Raw Material, Consumable aur Semi-FG ka live stock — Finished Goods yahan nahi, alag page par hai. Stock kahin store nahi hota — har baar In/Out entries se nikala jaata hai.":
    "Live stock for Raw Material, Consumable and Semi-FG — Finished Goods isn't here, it has its own page. Stock is never stored — it is worked out from the In and Out entries every time.",
  "Finished Goods": "Finished Goods",
  "Sirf FG category ke items ka live stock — raw material/consumable se alag, taaki dono kabhi mix na hon.":
    "Live stock for FG-category items only — kept apart from raw material/consumable so the two never mix.",
  "Planning ke number bharne se pehle item master me item banane honge.":
    "Items have to exist in the item master before their planning figures can be filled in.",
  "Planning fields": "Planning fields",
  "Movement history": "Movement history",
  "Khaali chhodenge to bann jaayega": "Leave blank and one will be generated",
  "Department, machine, ya vyakti": "Department, machine or person",
  "Manually set": "Set manually",
  "Kisko / Remark": "Issued to / remark",
  "Bulk Import": "Bulk Import",
  "Bulk Import — Items": "Bulk Import — Items",
  "Template download karein, usi format me apna data bharein, phir upload karein — sab items ek baar me ban jaayenge. Opening Stock column me kuch likhenge to us item ka stock bhi turant record ho jaayega.":
    "Download the template, fill in your data in the same format, then upload it — every item is created in one go. Fill in the Opening Stock column and that item's stock is recorded right away too.",
  "Template Download karein": "Download Template",
  "Filled-in file (CSV ya Excel)": "Filled-in file (CSV or Excel)",
  "item ban gaye": "items created",
  "me Opening Stock bhi record ho gaya": "of which also had Opening Stock recorded",
  "row skip ho gayi(n) errors ki wajah se": "row(s) skipped due to errors",
  "Import karein": "Import",
  "Import nahi ho paya.": "Import failed.",
  "Koi file nahi mili.": "No file was found.",
  "Sirf .csv, .xlsx ya .xls file upload karein.": "Only .csv, .xlsx or .xls files can be uploaded.",
  "File padhi nahi ja saki — sahi template download karke dobara try karein.":
    "The file could not be read — download the correct template and try again.",
  "File me koi row nahi mili.": "No rows were found in the file.",
  "File khaali hai.": "The file is empty.",
  "File ke headers pehchane nahi gaye — 'Item Name' column nahi mila. Template download karke usi format me data bharein.":
    "The file's headers were not recognized — no 'Item Name' column was found. Download the template and fill it in in the same format.",
  "Item ka naam zaroori hai.": "Item name is required.",
  "UOM zaroori hai.": "UOM is required.",

  // --- reorder and indents ---------------------------------------------------------
  "Abhi kisi item ko order ki zaroorat nahi": "Nothing needs ordering right now",
  "Har item apne reorder point se upar hai.": "Every item is above its reorder point.",
  "Reorder list load ho rahi hai": "Loading the reorder list",
  "Reorder list load nahi ho payi.": "Could not load the reorder list.",
  "Indent raise karein": "Raise an indent",
  "Indent nahi ban paye.": "Could not create the indent.",
  "Indents load ho rahe hain": "Loading indents",
  "Indents load nahi ho paye.": "Could not load indents.",
  "Received quantity daalein.": "Enter the quantity received.",
  "Receive nahi ho paya.": "Could not record the receipt.",
  "Sab select karein": "Select all",
  "Sirf adhoore": "Incomplete only",

  // --- BOM -------------------------------------------------------------------------
  "Nayi BOM": "New BOM",
  "Product ka naam": "Product name",
  "Ek saath rows": "Rows at once",
  "Rows banayein": "Add rows",
  "Ek aur line": "One more line",
  "Hatayein": "Remove",
  "Qty / unit": "Qty per unit",
  "Purani versions": "Older versions",
  "Abhi koi BOM nahi hai": "No BOM yet",
  "Production planning tabhi chalegi jab product ki BOM bani ho.":
    "Production planning only works once a product has a BOM.",
  "Kam se kam ek line me item aur quantity daalein.":
    "Fill in an item and a quantity on at least one line.",
  "BOM save nahi ho payi.": "Could not save the BOM.",
  "BOMs load ho rahi hain": "Loading BOMs",
  "BOMs load nahi ho payi.": "Could not load BOMs.",
  "Har product ke liye kaun se item kitne lagte hain. BOM badalne par purani version archive ho jaati hai, mitti nahi — taaki puraane record padhe ja sakein.":
    "What each product is made from, and how much of each. Changing a BOM archives the old version rather than erasing it, so past records stay readable.",

  // --- PPC -------------------------------------------------------------------------
  "Naya plan": "New plan",
  "Naya production plan": "New production plan",
  "Koi chalu plan nahi hai": "No active plans",
  "Naya plan banate hi uska material reserve ho jaata hai.":
    "Creating a plan reserves its material straight away.",
  "Plan banate hi material reserve ho jaata hai. Ek hi stock do plan ko nahi mil sakta — jiski production date pehle hai, use pehle milta hai.":
    "Creating a plan reserves its material. The same stock cannot go to two plans — whichever has the earlier production date gets it first.",
  "Plan save nahi ho paya.": "Could not save the plan.",
  "Plans load ho rahe hain": "Loading plans",
  "Plans load nahi ho paye.": "Could not load plans.",
  "Product list load nahi hui.": "Could not load the product list.",
  "Product, quantity aur date bharein.": "Fill in product, quantity and date.",
  "Production date": "Production date",
  "Production shuru": "Start production",
  "Production shuru karein": "Start production",
  "Actual quantity 0 se zyada honi chahiye.": "Actual quantity must be more than 0.",
  "Material check": "Material check",
  "Dobara check": "Check again",
  "Purane plan": "Past plans",
  "Ek aur product": "One more product",
  "Check nahi ho paya.": "Could not run the check.",
  "Chahiye": "Needed",
  "Milega": "Available",
  "Kam": "Short",
  "Laga": "Used",
  "Order No (optional)": "Order No (optional)",
  "Customer ka PO number": "Customer's PO number",
  "Production Line (optional)": "Production Line (optional)",
  "Koi Line select nahi": "No Line selected",
  "Job": "Job",
  "Order No": "Order No",

  // --- inward and IQC --------------------------------------------------------------
  "Naya Inward Entry": "New inward entry",
  "Vendor Master se linked hai.": "Linked to Vendor Master.",
  "Naam type karein, vendor list se chunein ya naya likhein": "Type a name, pick from the vendor list or enter a new one",
  "Material aane par yeh form bharein.": "Fill this in when material arrives.",
  "Inward entry submit ho gayi.": "Inward entry submitted.",
  "Entry save nahi ho payi.": "Could not save the entry.",
  "Koi inward entry nahi hai.": "No inward entries.",
  "Inward entries load ho rahi hain": "Loading inward entries",
  "Inward entries load nahi ho payi.": "Could not load inward entries.",
  "Material inward entries, unka quality check, aur uska result.":
    "Inward entries, their quality check, and the result.",
  "Quality check save ho gaya.": "Quality check saved.",
  "Quality check ka nateeja.": "The result of the quality check.",
  "Fail Qty ho to Fail Reason zaroori hai.":
    "A fail reason is required when there is a fail quantity.",
  "Verified stock jo andar aaya.": "Verified stock that came in.",
  "Abhi tak koi rejection record nahi hua.": "No rejections recorded yet.",
  "Abhi tak koi verified stock record nahi hua.": "No verified stock recorded yet.",
  "Pending IQC entries load nahi ho payi.": "Could not load pending IQC entries.",
  "Records load ho rahe hain": "Loading records",
  "Records load nahi ho paye.": "Could not load records.",
  "Kyun": "Why",

  // --- admin: users ----------------------------------------------------------------
  "Naya User Banayein": "Create a user",
  "Naye users banayein aur unke roles manage karein.":
    "Create users and manage their roles.",
  "Email aur password set karein — user isi se login karega.":
    "Set an email and password — this is what they will sign in with.",
  "User update ho gaya.": "User updated.",
  "Password reset ho gaya.": "Password reset.",
  "Koi active user nahi mila.": "No active users found.",
  "Users load ho rahe hain": "Loading users",
  "Users load nahi ho paye.": "Could not load users.",
  "Users list load nahi ho payi.": "Could not load the user list.",
  "Full access": "Full access",

  // --- admin: settings -------------------------------------------------------------
  "Logo, WhatsApp, aur baaki organization settings manage karein.":
    "Manage the logo, WhatsApp, and other organization settings.",
  "Settings kholein": "Open Settings",
  "Settings load nahi ho payi.": "Could not load settings.",
  "Save nahi ho paya.": "Could not save.",
  "Update nahi ho paya.": "Could not update.",
  "Status update nahi ho paya.": "Could not update the status.",
  "Kaam nahi hua.": "That did not work.",
  "WhatsApp settings save ho gayi.": "WhatsApp settings saved.",
  "WhatsApp settings load ho rahi hain": "Loading WhatsApp settings",
  "WhatsApp settings load nahi ho payi.": "Could not load WhatsApp settings.",
  "Test message bhej diya — apna WhatsApp check karein.":
    "Test message sent — check your WhatsApp.",
  "Logo load ho raha hai": "Loading the logo",
  "Logo load nahi ho paya.": "Could not load the logo.",
  "Logo save nahi ho paya.": "Could not save the logo.",
  "Logo padha nahi ja saka.": "The logo could not be read.",
  "Logo taiyaar hai.": "Logo ready.",
  "Logo PNG, JPG ya WebP hona chahiye.": "The logo must be a PNG, JPG or WebP.",
  "Abhi yahi logo laga hua hai.": "This is the logo currently in use.",
  "File upload ho gayi.": "File uploaded.",
  "Upload nahi ho paya — server se file ka link nahi mila.":
    "Upload failed — the server did not return a file link.",
  "Upload nahi ho paya. Internet check karke dobara try karein.":
    "Upload failed. Check your connection and try again.",
  "Badlein": "Change",
  "Bas ho gaya": "All done",

  // --- platform --------------------------------------------------------------------
  "Abhi tak koi organization signup nahi hua.": "No organization has signed up yet.",
  "Organizations load ho rahi hain": "Loading organizations",
  "Organizations load nahi ho paye.": "Could not load organizations.",
  "Suspend karne ka matlab": "What suspending does",
  "Is install par chal rahe saare organizations. Ye sirf platform operator ke liye hai — kisi organization ke Admin ko ye page dikhta hi nahi.":
    "Every organization running on this install. This is for the platform operator only — an organization's own Admin never sees this page.",

  // --- empty and filtered states ---------------------------------------------------
  "Abhi koi data nahi.": "No data yet.",
  "Abhi koi item nahi hai.": "No items yet.",
  "Abhi koi indent nahi hai. Reorder page se banayein.":
    "No indents yet. Raise one from the Reorder page.",
  "Is filter par koi indent nahi mila.": "No indents match this filter.",
  "Is filter par koi item nahi mila.": "No items match this filter.",
  "Koi recurring rule nahi hai.": "No recurring rules.",
  "Koi rejection nahi — achhi baat hai.": "No rejections — which is good news.",
  "Sab items ke planning fields bhare hue hain.":
    "Every item's planning fields are filled in.",

  // --- period-filtered analytics ---------------------------------------------------
  "Is period me koi data nahi.": "No data in this period.",
  "Is period me aapne koi task assign nahi kiya.":
    "You did not assign any tasks in this period.",
  "Is period me kisi ka score evaluate nahi hua.":
    "Nobody's score was evaluated in this period.",
  "Is period me koi task evaluate nahi hua.": "No task was evaluated in this period.",
  "Is period me koi inward entry nahi.": "No inward entries in this period.",
  "Is period me koi quality check nahi hua.": "No quality check in this period.",
  "Is period me koi verified stock nahi.": "No verified stock in this period.",

  // --- chart and figure captions ---------------------------------------------------
  "Bar jitna lamba, penalty utni zyada. Har bar par uska score likha hai.":
    "The longer the bar, the bigger the penalty. Each bar carries its own score.",
  "Har rang ke saath uski ginti bhi likhi hai — sirf rang par nahi jaana padta.":
    "Every colour carries its count as well, so nothing depends on colour alone.",
  "Har movement ke baad ka balance — wahi hisaab, bas har kadam par.":
    "The balance after each movement — the same arithmetic, step by step.",
  "Kitne log kis haalat me hain.": "How many people are in each state.",
  "Quantity, entries ki ginti nahi.": "Quantity, not the number of entries.",
  "Pichle 30 din ke Out se": "From the last 30 days of Out movements",
  "Naya kaam plan karne ke liye itna hi available hai":
    "This is all that is available to plan new work against",

  // --- form hints ------------------------------------------------------------------
  "Naam se apne aap bana — badal sakte hain.":
    "Generated from the name — you can change it.",
  "Aapka apna SKU.": "Your own SKU.",
  "Admin ke paas har module ka access apne aap hota hai.":
    "An Admin holds access to every module automatically.",
  "Jo modules tick karenge, wahi is user ke dashboard par dikhenge.":
    "The modules you tick are the ones that appear on this person's dashboard.",
  "PNG, JPG ya WebP — 1MB tak. Ye aapke system ke header me dikhega.":
    "PNG, JPG or WebP, up to 1MB. This appears in your system's header.",
  "Logo save ho gaya — page refresh karke header me dekhein.":
    "Logo saved — refresh the page to see it in the header.",

  // --- messages raised on the server ------------------------------------------------
  //
  // These come back to the browser as an error string and are shown in a toast, so the
  // client translates them at the point it displays them. The server has no locale of
  // its own — a cron run belongs to no reader.
  "Is email se pehle se ek user maujood hai.":
    "A user with this email already exists.",
  "ChatXFlow abhi Settings me configure nahi hua hai.":
    "ChatXFlow is not configured in Settings yet.",
  "File storage abhi configure nahi hui hai. Platform administrator se kahein ki blob storage set karein.":
    "File storage is not configured yet. Ask the platform administrator to set up blob storage.",
  "Logo storage abhi configure nahi hui hai. Platform administrator se kahein.":
    "Logo storage is not configured yet. Please ask the platform administrator.",

  "Product ka naam zaroori hai.": "A product name is required.",
  "Har line me ek item chunna zaroori hai.": "Every line needs an item.",
  "Har line me product chunein.": "Choose a product on every line.",
  "Received indent cancel nahi ho sakta.":
    "An indent that has been received cannot be cancelled.",
  "Sirf Ready ya Shortage plan dobara check ho sakta hai.":
    "Only a Ready or Shortage plan can be checked again.",
  "Production shuru ho chuka hai — ab cancel nahi ho sakta.":
    "Production has already started — it cannot be cancelled now.",
  "Ye plan pehle hi band ho chuka hai.": "This plan is already closed.",
  "Sirf chal raha plan complete ho sakta hai.":
    "Only a plan that is running can be completed.",
  "Ye plan production ke liye taiyar nahi hai.":
    "This plan is not ready for production.",
  "Yeh entry pehle se verify ho chuki hai.":
    "This entry has already been verified.",
  "Ye recurring rule nahi mila.": "That recurring rule was not found.",
  "Aap sirf apne assigned tasks complete kar sakte hain.":
    "You can only complete tasks assigned to you.",
  "Yeh task pehle se complete ho chuka hai.": "This task is already complete.",

  "Due date se pehle complete hua — koi penalty nahi.":
    "Completed before the due date — no penalty.",
  "Due date nikal chuki hai aur task abhi bhi pending hai — poori penalty.":
    "The due date has passed and the task is still pending — full penalty.",

  // --- module access grants (src/lib/moduleAccess.ts) ------------------------------
  "Doosron ko one-time task assign kar sakta hai":
    "Can assign one-off tasks to other people",
  "Repeating task rules bana sakta hai": "Can create repeating task rules",
  "Nayi inward entry daal sakta hai": "Can record new inward entries",
  "Inward entries ka quality check kar sakta hai":
    "Can run the quality check on inward entries",
  "Verified stock aur failure records dekh sakta hai":
    "Can view verified stock and failure records",
  "Items aur unka live stock dekh sakta hai": "Can view items and their live stock",
  "Material andar-bahar ki entry kar sakta hai": "Can record stock in and out",
  "Naye items bana sakta hai aur Max Level, Lead Time jaise settings bhar sakta hai":
    "Can create items and fill in settings such as Max Level and Lead Time",
  "Product ki Bill of Materials bana aur badal sakta hai":
    "Can create and change a product's Bill of Materials",
  "Production plan bana sakta hai aur material reserve kar sakta hai":
    "Can create production plans and reserve material",
  "Purchase indents approve aur receive kar sakta hai":
    "Can approve and receive purchase indents",
  "Poori team ka MIS score dekh sakta hai": "Can view the whole team's MIS score",

  // --- analytics -------------------------------------------------------------------
  "Aapko assign hue tasks, samay ke saath.": "Tasks assigned to you, over time.",

  // --- guidebook page chrome (the content itself lives in guide.en.ts) --------------
  "Sirf wahi cheezein jo aap is system me kar sakte hain":
    "Only the things you can actually do in this system",
  "Aapka access badlega to ye guide bhi apne aap badal jaayegi.":
    "As your access changes, this guide changes with it.",

  // --- user and organization deletion -----------------------------------------------
  "User delete karein": "Delete this user",
  "User delete nahi ho paya.": "Could not delete the user.",
  "delete ho gaya.": "has been deleted.",
  "delete ho gayi.": "has been deleted.",
  "ko delete karein?": "— delete?",
  "Delete ho raha hai...": "Deleting...",
  "Delete User": "Delete user",
  "Haan, delete karein": "Yes, delete",
  "Delete karein": "Delete",
  "Delete nahi ho paya.": "Could not delete.",
  "Aap khud ko delete nahi kar sakte.": "You cannot delete your own account.",
  "Ye organization ka aakhri Admin hai. Pehle kisi aur ko Admin banayein.":
    "This is the organization's last Admin. Make somebody else an Admin first.",
  "Organization nahi mili.": "That organization was not found.",
  "Organization ka naam theek se likhein.":
    "Type the organization's name exactly.",
  "User hat jaayega aur uska email dobara istemaal ho sakega. Uske purane tasks aur records waise ke waise rahenge.":
    "The user is removed and their email becomes available again. Their past tasks and records are left exactly as they are.",
  "Ye user hat jaayega aur uska email dobara istemaal ho sakega. Wo turant login nahi kar payega. Uske purane tasks aur records nahi mitenge — wo record hain ki kya hua tha.":
    "This user will be removed and their email freed for reuse. They will not be able to sign in from now on. Their past tasks and records are not deleted — those are a record of what happened.",
  "Pakka karne ke liye organization ka naam likhein":
    "Type the organization's name to confirm",
  "MIS score timestamps se calculate hota hai. 0% sabse achha, −100% sabse kharab — late aur chhoote hue tasks penalty banate hain.":
    "The MIS score is calculated from timestamps. 0% is the best and −100% the worst — late and missed tasks build the penalty.",

  // --- reports and public share links -----------------------------------------------
  "share karein": "share",
  "Is link ka naam": "Name this link",
  "Jaise: Supplier ke liye monthly report": "e.g. Monthly report for the supplier",
  "Link banayein": "Create link",
  "Ban raha hai...": "Creating...",
  "Chalu links": "Active links",
  "Link band karein": "Revoke this link",
  "Ye link band karein?": "Revoke this link?",
  "Haan, band karein": "Yes, revoke it",
  "Link ban gaya aur copy ho gaya.": "Link created and copied.",
  "Link nahi ban paya.": "Could not create the link.",
  "Link band ho gaya.": "Link revoked.",
  "Link band nahi ho paya.": "Could not revoke the link.",
  "Links load nahi ho paye.": "Could not load the links.",
  "Copy nahi ho paya.": "Could not copy.",
  "Copy ho gaya": "Copied",
  "Link jiske paas hoga wo ye report bina login ke dekh sakega, aur data hamesha taaza rehta hai. Wo sirf dekh sakta hai — kuch badal nahi sakta.":
    "Anyone with the link can read this report without signing in, and the data stays live. They can only read it — nothing can be changed.",
  "Link me wahi sections aayenge jo aap khud dekh sakte hain. Baad me aapko naya access mile to purane link nahi badlenge.":
    "The link shows the sections you can see yourself. If you are given more access later, links you already shared do not widen.",
  "Jis kisi ke paas ye link hai, uske liye ye turant kaam karna band kar dega. Ye wapas nahi aayega — naya link banana padega.":
    "It stops working immediately for anyone holding it. This cannot be undone — a new link would have to be created.",
  "Ye link ab kaam nahi karta.": "This link no longer works.",
  "Live report — sirf padhne ke liye": "Live report — read only",
  "Ye report live hai — page refresh karne par taaza data aata hai.":
    "This report is live — refreshing the page shows the latest data.",

  // --- reports, split one per page --------------------------------------------------
  "Har module ki apni report. Jo aapke access me hai, wahi yahan dikhta hai — aur har report alag se share ki ja sakti hai.":
    "A report of its own for every module. You see the ones your access covers, and each can be shared on its own.",
  "Abhi koi report nahi hai": "No reports yet",
  "Aapke Admin ne jo modules diye honge, unki reports yahan aayengi.":
    "Reports appear here for whichever modules your Admin has given you.",
  "Saari reports": "All reports",
  "Aapka score": "Your score",
  "Ye report share nahi ho sakti.": "This report cannot be shared.",
  "Is report ka access nahi hai.": "You do not have access to this report.",

  // report names and descriptions (src/lib/reports.ts)
  "My tasks": "My tasks",
  "Aapko assign hue tasks — result aur samay ke saath.":
    "Tasks assigned to you — the outcome and the timing.",
  "Material inward entries aur unka IQC status.":
    "Inward entries and their IQC status.",
  "Quality check ka nateeja — pass, fail aur kyun.":
    "The result of the quality check — pass, fail and why.",
  "Aaj ka stock status aur reorder ki haalat.":
    "Stock status today, and where reorder stands.",
  "Purchase requests aur unki haalat.": "Purchase requests and their state.",
  "Kis product me kitne item lagte hain.": "How many items each product takes.",
  "Production plans aur unki haalat.": "Production plans and their state.",
  "Poori team ka MIS score, doer wise.":
    "The whole team's MIS score, person by person.",

  // --- new report sections ----------------------------------------------------------
  "Aaj ka stock — ye period filter par nahi badalta.":
    "Stock as it stands today — this does not follow the period filter.",
  "Stock status": "Stock status",
  "Free stock ko reorder point se tolkar.":
    "Free stock weighed against the reorder point.",
  "Reorder point se sabse neeche": "Furthest below the reorder point",
  "Jo apne reorder point se sabse zyada neeche gir chuka hai.":
    "Whichever has fallen furthest below its own reorder point.",
  "purchase requests.": "purchase requests.",
  "Indent status": "Indent status",
  "Indents kab bane": "When indents were raised",
  "Is period me koi indent nahi.": "No indents in this period.",
  "Kis product me kitne item lagte hain — aaj ki active BOMs.":
    "How many items each product takes — today's active BOMs.",
  "Product me kitne item": "Items per product",
  "Sirf active version ginti me hai.": "Only the active version is counted.",
  "Active vs Archived": "Active vs archived",
  "production plans aur unki haalat.": "production plans and their state.",
  "Plan status": "Plan status",
  "Is period me koi plan nahi bana.": "No plan was created in this period.",
  "Production kab honi hai": "When production is due",
  "Plan ki production date ke hisaab se.": "By the plan's production date.",

  // --- shared UI -------------------------------------------------------------------
  "Chunein...": "Select...",
  "Poora": "Full",
  "Ek": "One",
  "Sab select karein ": "Select all ",

  // --- fms (flows) -------------------------------------------------------------------
  "FMS": "FMS",
  "Multi-step FMS processes — apne pending steps dekhein, ya (agar authorized hain) naya FMS template banayein.":
    "Multi-step FMS processes — see your pending steps, or (if authorized) build a new FMS template.",
  "Mere Steps": "My Steps",
  "Templates": "Templates",
  "Steps load nahi ho paye.": "Steps could not be loaded.",
  "Steps load ho rahe hain": "Loading steps",
  "Koi pending step nahi hai": "No pending steps",
  "Kisi FMS ka step aapko assign hote hi yahan dikhega.":
    "A step will show up here as soon as an FMS assigns one to you.",
  "Step": "Step",
  "Deadline": "Deadline",
  "Complete": "Complete",
  "Outcome chunein.": "Choose an outcome.",
  "Step complete nahi ho paya.": "Step could not be completed.",
  "Step complete ho gaya.": "Step completed.",
  "Remark (optional)": "Remark (optional)",
  "Remark": "Remark",
  "FMS Steps": "FMS Steps",
  "Aaj koi FMS step nahi hai.": "No FMS steps for today.",
  "Saare steps dekhein": "See all steps",
  "History": "History",
  "History load nahi ho payi.": "History could not be loaded.",
  "History load ho rahi hai": "Loading history",
  "Doer, Job No, Order No, ya Step search karein...": "Search by doer, Job No, Order No, or step...",
  "Doer": "Doer",
  "Job / Order No": "Job / Order No",
  "Kab": "When",
  "Abhi koi history nahi hai": "No history yet",
  "Jaise hi koi FMS step complete hoga, wo yahan dikhega.":
    "As soon as an FMS step is completed, it will show up here.",
  "Is search se koi history nahi mili.": "No history matches this search.",
  "Task / Step": "Task / Step",
  "Complete karein": "Complete",
  "Templates load nahi ho paye.": "Templates could not be loaded.",
  "Status badal nahi paya.": "Status could not be changed.",
  "Templates load ho rahe hain": "Loading templates",
  "Chhupayein": "Hide",
  "Steps dekhein": "View steps",
  "Archive": "Archive",
  "Activate": "Activate",
  "Delete": "Delete",
  "delete karein?": "— delete?",
  "Ye template permanently mit jaayegi. Isko koi Pending step abhi use nahi kar raha ho tabhi ye delete hogi — agar koi step abhi bhi chal raha hai, delete refuse ho jaayegi.":
    "This template will be permanently deleted. It only deletes while no Pending step is still using it — if a step is still running, the delete is refused.",
  "Template delete nahi ho payi.": "Template could not be deleted.",
  "Template delete ho gayi.": "Template deleted.",
  "Template nahi mila.": "Template not found.",
  "Sirf Archived template delete ki ja sakti hai — pehle Archive karein.":
    "Only an Archived template can be deleted — archive it first.",
  "Is template ke against abhi bhi ek Pending step chal raha hai — pehle use complete hone dein, phir delete karein.":
    "A Pending step is still running against this template — let it complete first, then delete.",
  "Trigger": "Trigger",
  "Assigned To": "Assigned To",
  "Next step per outcome": "Next step per outcome",
  "Abhi koi FMS template nahi hai": "No FMS templates yet",
  "Naya template banayein taaki multi-step FMS run ho sakein.":
    "Create a template so multi-step FMS can run.",
  "Naya FMS Template": "New FMS Template",
  "Ek step ka outcome decide karta hai agla kaunsa step chalega. \"MANUAL\" trigger sirf haath se start hota hai — koi module-event ya doosre FMS template ka outcome key (e.g. INWARD_ENTRY_CREATED) bhi de sakte hain.":
    "A step's outcome decides which step runs next. The \"MANUAL\" trigger only starts by hand — you can also give it a module event or another FMS template's outcome key (e.g. INWARD_ENTRY_CREATED).",
  "Template ka naam": "Template name",
  "Template ka naam zaroori hai.": "Template name is required.",
  "Har step ka naam, assignee, aur TAT bharein.": "Fill in every step's name, assignee, and TAT.",
  "Template save nahi hui.": "Template could not be saved.",
  "FMS template ban gaya.": "FMS template created.",
  "Step ka naam": "Step name",
  "User chunein": "Select a user",
  "Unit": "Unit",
  "Minutes": "Minutes",
  "Hours": "Hours",
  "Days": "Days",
  "Outcomes (comma se alag)": "Outcomes (comma-separated)",
  "Har outcome ke baad agla step": "Next step for each outcome",
  "Fail Qty hamesha isi step par, usi doer ke paas, rework ke liye wapas aati hai — koi step yahan select nahi hota. Sirf Pass Qty ke liye agla step chunein.":
    "Fail Qty always comes back to this same step, to the same doer, for rework — no step is selected here. Only choose the next step for Pass Qty.",
  "FMS khatam": "End FMS",
  "Ek aur step": "Add another step",
  "Template banayein": "Create template",
  "Company Running Time (FMS)": "Company Running Time (FMS)",
  "FMS turnaround time sirf in working hours ke andar count hoti hai — shift, lunch, aur (agar diya ho) tea break ke bahar ka time nahi gina jaata.":
    "FMS turnaround time only counts within these working hours — time outside the shift, lunch, and (if set) tea break is never counted.",
  "Shift settings load nahi ho payi.": "Shift settings could not be loaded.",
  "Shift settings save ho gayi.": "Shift settings saved.",
  "Shift settings load ho rahi hain": "Loading shift settings",
  "Shift": "Shift",
  "Shuru": "Start",
  "Khatam": "End",
  "Lunch shuru": "Lunch start",
  "Lunch khatam": "Lunch end",
  "Tea shuru (optional)": "Tea start (optional)",
  "Tea khatam (optional)": "Tea end (optional)",
  "Ek aur shift": "Add another shift",
  "Weekly Off": "Weekly Off",
  "In dino ko default off maana jaayega. Kisi khaas date ko kholna ho (jaise ek Sunday production ke liye) to Week-off Overrides me add karein.":
    "These days are treated as off by default. To open a specific date back up (say, for a Sunday production run), add it under Week-off Overrides.",
  "Weekly Off Overrides": "Weekly Off Overrides",
  "Kisi normally-off date (jaise ek khaas Sunday) ko sabke liye, ek Department ke liye, ya ek user ke liye working khol dein.":
    "Open a normally-off date (say, one particular Sunday) back up for everyone, one Department, or one user.",
  "Overrides load nahi ho paye.": "Overrides could not be loaded.",
  "Overrides load ho rahe hain": "Loading overrides",
  "Date chunein.": "Choose a date.",
  "Department ya User ID bharein.": "Fill in a Department or User ID.",
  "Override add nahi hua.": "Override could not be added.",
  "Override add ho gaya.": "Override added.",
  "Scope": "Scope",
  "Sabke liye": "For everyone",
  "Ek Department ke liye": "For one Department",
  "Ek User ke liye": "For one user",
  "Department": "Department",
  "Value": "Value",
  "Add": "Add",
  "FMS Shift": "FMS Shift",

  // --- holiday list --------------------------------------------------------------------
  "Holiday List": "Holiday List",
  "In dates par koi bhi recurring task, FMS ya IQC deadline nahi ginti — weekly-off (upar wala) ke alawa ye extra non-working days hain.":
    "No recurring task, FMS, or IQC deadline counts these dates — on top of the weekly-off day above, these are extra non-working days.",
  "Holiday List load nahi ho payi.": "The Holiday List could not be loaded.",
  "Holiday List load ho rahi hai": "Loading the Holiday List",
  "Holiday add nahi hua.": "The holiday could not be added.",
  "Holiday add ho gaya.": "Holiday added.",
  "Save ho gaya.": "Saved.",
  "Naam (optional)": "Name (optional)",
  "Naam": "Name",
  "Abhi koi holiday nahi hai.": "No holidays yet.",
  "Holiday": "Holiday",
  "Bina country code ke 10-digit number bhi chalega — 91 apne aap lag jaata hai.":
    "A bare 10-digit number without a country code works too — 91 is added automatically.",

  // --- inward IQC TAT ----------------------------------------------------------------
  "IQC Deadline": "IQC Deadline",
  "IQC TAT settings load nahi ho payi.": "IQC TAT settings could not be loaded.",
  "IQC TAT settings load ho rahi hain": "Loading IQC TAT settings",
  "Inward IQC — Turnaround Time": "Inward IQC — Turnaround Time",
  "Ek nayi Inward entry ke liye IQC check kitne time me hona chahiye — deadline company ke working hours (Settings me set shift/lunch/tea/weekly-off) ke hisaab se ginti hai. Baaki Inward flow (entry, verify, Pass/Fail routing) bilkul waisa hi rehta hai.":
    "How long a new Inward entry's IQC check should take — the deadline counts only the company's working hours (the shift/lunch/tea/weekly-off set in Settings). The rest of the Inward flow (entry, verify, Pass/Fail routing) stays exactly as it is.",
  "IQC TAT save ho gaya.": "IQC TAT saved.",
  "Ye sirf nayi entries par lagu hoga — jo entries pehle se ban chuki hain unki deadline nahi badlegi.":
    "This only applies to new entries — entries already created keep their existing deadline.",

  // --- fms data source / action -------------------------------------------------------
  "Step ki details load nahi ho payi.": "Step details could not be loaded.",
  "Ye fields zaroori hain": "These fields are required",
  "Load ho raha hai...": "Loading...",
  "Modules load nahi ho paye.": "Modules could not be loaded.",
  "Data Source": "Data Source",
  "Koi nahi (sirf Outcome/Remark)": "None (Outcome/Remark only)",
  "Naya Form": "New Form",
  "Existing FMS se": "From Existing FMS",
  "Question ka naam": "Question label",
  "Text": "Text",
  "Number": "Number",
  "Date": "Date",
  "Dropdown": "Dropdown",
  "Attachment": "Attachment",
  "Options (comma se alag)": "Options (comma-separated)",
  "Outcome Type": "Outcome Type",
  "Done": "Done",
  "Pass aur Fail": "Pass and Fail",
  "Pass, Fail aur Scrap Qty": "Pass, Fail and Scrap Qty",
  "Custom (khud likhein)": "Custom (type your own)",
  "Outcome Type se auto-add hua": "Auto-added by Outcome Type",
  "Pass, Fail aur Scrap Qty non-negative number honi chahiye.":
    "Pass, Fail and Scrap Qty must be non-negative numbers.",
  "Zaroori": "Required",
  "Ek aur question": "Add another question",
  "Source chunein": "Choose a source",
  "Isi FMS ka pehle wala step": "An earlier step of this FMS",
  "Kaunsa step": "Which step",
  "Deadline pichle step ke field se nikaale (TAT ke bajaye)":
    "Take the deadline from an earlier step's field (instead of TAT)",
  "Kaunsa field": "Which field",
  "ka field": "'s field",
  "Offset (+/-)": "Offset (+/-)",
  "Jaise: Step 1 me 'Lead Days' bhara, is step ka offset -1 rakhne se deadline (Lead Days − 1) ban jaati hai — TAT box sirf fallback hai agar value na mile.":
    "For example: Step 1 captured 'Lead Days'; setting this step's offset to -1 makes its deadline (Lead Days − 1) — the TAT box is only a fallback if the value can't be found.",
  "Columns": "Columns",
  "Sirf isi instance ka record (condition)": "Only this instance's own record (condition)",
  "Action": "Action",
  "Koi nahi": "None",
  "Stock Ledger Movement": "Stock Ledger Movement",
  "Pehle Outcomes bharein.": "Fill in Outcomes first.",
  "SKU field": "SKU field",
  "Qty field": "Qty field",
  "UOM field (optional)": "UOM field (optional)",
  "Item ka UOM use karein": "Use the Item's own UOM",
  "Notify via WhatsApp": "Notify via WhatsApp",
  "Step complete hote hi in logon ko WhatsApp message jaayega — chahe wo is flow ka hissa na hon (jaise ek supervisor jo bas jaan na chahta hai).":
    "These people get a WhatsApp message the moment this step is completed — even if they aren't part of this flow (e.g. a supervisor who just wants to know).",
  "Instance start nahi ho paya.": "Instance could not be started.",
  "FMS start ho gaya — pehla step assign ho gaya.": "FMS started — the first step has been assigned.",
  "Start": "Start",
  "Dono ek saath chuna ja sakta hai — jaise ek step apna Pass/Fail khud type kare, aur saath me pichle step ka data bhi dekhe.":
    "Both can be turned on together — e.g. a step types its own Pass/Fail while also seeing the previous step's data.",
  "Edit": "Edit",
  "Template Edit karein": "Edit Template",
  "Save karne par ek naya version banega aur purana version Archive ho jaayega — jo instance abhi chal raha hai wo purane version se hi chalta rahega, kisi ke beech me kuch nahi badlega.":
    "Saving creates a new version and archives the old one — any instance already running keeps running against the old version; nothing changes underneath it mid-flow.",
  "Naya version ban gaya, purana Archive ho gaya.": "New version created, the old one archived.",
  "Naya version save karein": "Save new version",

  // --- fms: lookup field, reset, flow board -----------------------------------------
  "Lookup (dusre module se)": "Lookup (from another module)",
  "Kaunsa module": "Which module",
  "Naam/label wala column": "Column with the name/label",
  "Chunne par ye fields auto-fill hon (is step ke doosre fields)":
    "Selecting a row auto-fills these fields (this step's other fields)",
  "None": "None",
  "Is step me abhi koi aur field nahi hai autofill karne ke liye.":
    "This step has no other field yet to autofill.",
  "Lookup list load nahi ho payi.": "Could not load the lookup list.",
  "Search karein...": "Search...",
  "Koi match nahi mila.": "No matches found.",
  "Saare FMS Templates + Runs Reset Karein": "Reset All FMS Templates + Runs",
  "Saare FMS data reset karein?": "Reset all FMS data?",
  "Ye is organization ke SAARE FMS templates (jo bhi design kiye gaye hain), aur unke saare runs — pending tasks aur poori history — permanently delete kar dega. Ye wapas nahi aata.":
    "This will permanently delete ALL of this organization's FMS templates (however many have been designed), and all of their runs — pending tasks and the full history. This cannot be undone.",
  "Pakka karne ke liye likhein": "Type this to confirm",
  "Rehne dein": "Keep it",
  "Reset ho raha hai...": "Resetting...",
  "Sab Delete Karein": "Delete Everything",
  "Flow ka data load nahi ho paya.": "Could not load the flow's data.",
  "Flow load ho raha hai": "Loading flow",
  "Is flow ka abhi tak koi instance nahi chala": "This flow hasn't run yet",
  "Jaise hi ye flow kisi trigger se ya manually start hoga, wo yahan dikhega.":
    "As soon as this flow starts — by a trigger or manually — it will show up here.",
  "Reference search karein...": "Search by reference...",
  "Reference": "Reference",
  "Current Step": "Current Step",
  "Kiske Paas": "Held By",
  "Shuru Hua": "Started",
  "Is search se koi instance nahi mila.": "No instance matches this search.",
  "Shuru hua": "Started",
  "Assigned": "Assigned",
  "Abhi shuru nahi hua.": "Not started yet.",
  "Attempt": "Attempt",
  "Plan": "Planned",
  "Actual": "Actual",
  "Is flow ke saare instances — kaunsa step chal raha hai, kiske paas hai, aur ab tak kya hua.":
    "Every instance of this flow — which step is running, who holds it, and what's happened so far.",

  // --- vendor & customer master -------------------------------------------------------
  "Purchase Vendors / Customers": "Purchase Vendors / Customers",
  "Purchase Vendor aur Customer master — ek baar bana lein, aage PO, invoice aur sales order isi se juden ge. (Aage OEM ya Manufacturing Vendor jaise dusre vendor types alag se aa sakte hain — ye form sirf Purchase Vendor ke liye hai.)":
    "Purchase Vendor and Customer master — set these up once; POs, invoices and sales orders will all link back to them. (Other vendor types, like an OEM or Manufacturing Vendor, may be added separately later — this form is for Purchase Vendors only.)",
  "Purchase Vendors": "Purchase Vendors",
  "Customers": "Customers",
  "Purchase Vendor": "Purchase Vendor",
  "Customer": "Customer",
  "Add Purchase Vendor": "Add Purchase Vendor",
  "Naya Purchase Vendor": "New Purchase Vendor",
  "Ye Purchase Vendor hai — kaccha maal/parts kharidne ke liye. Sirf Vendor Name zaroori hai, baaki details baad me bhi bhari ja sakti hain.":
    "This is a Purchase Vendor — for buying raw material/parts. Only Vendor Name is required, the rest can be filled in later.",
  "Vendor Name": "Vendor Name",
  "Vendor ban gaya.": "Vendor created.",
  "Add Customer": "Add Customer",
  "Naya Customer": "New Customer",
  "Sirf Customer Name zaroori hai — baaki details baad me bhi bhari ja sakti hain.":
    "Only Customer Name is required — the rest can be filled in later.",
  "Customer Name": "Customer Name",
  "Customer ban gaya.": "Customer created.",
  "Contact Person": "Contact Person",
  "Phone": "Phone",
  "Address": "Address",
  "Billing Address": "Billing Address",
  "Shipping address billing jaisa hi hai": "Shipping address same as billing",
  "Shipping Address": "Shipping Address",
  "City": "City",
  "State": "State",
  "Payment Terms": "Payment Terms",
  "Jaise: Net 30": "e.g. Net 30",
  "Credit Terms": "Credit Terms",
  "Jaise: Net 15": "e.g. Net 15",
  "Bank Name": "Bank Name",
  "Account No.": "Account No.",
  "Save": "Save",
  "Vendors load nahi ho paye.": "Vendors could not be loaded.",
  "Vendors load ho rahe hain": "Loading vendors",
  "Abhi koi vendor nahi hai.": "No vendors yet.",
  "Customers load nahi ho paye.": "Customers could not be loaded.",
  "Customers load ho rahe hain": "Loading customers",
  "Abhi koi customer nahi hai.": "No customers yet.",
  "Bulk Upload": "Bulk Upload",
  "Template download karein, usi format me apna data bharein, phir upload karein — sab ek baar me ban jaayenge.":
    "Download the template, fill in your data in the same format, then upload it — everything is created in one go.",
  "ban gaye": "created",
  "duplicate naam ke saath ban gaye": "created with a duplicate name",

  // --- vendor <-> item linking (price, lead time, indent suggestions) ----------------
  "Vendor ke items load nahi ho paye.": "The vendor's items could not be loaded.",
  "Ye vendor kaun se item supply karta hai, kitne lead time me, aur kis price par — indent uthate waqt yahi list suggest hogi.":
    "Which items this vendor supplies, at what lead time and price — this is the list an indent will suggest.",
  "Item chunein.": "Choose an item.",
  "Item chunna zaroori hai.": "Choosing an item is required.",
  "Item link nahi ho paya.": "The item could not be linked.",
  "Item vendor se jud gaya.": "Item linked to the vendor.",
  "Lead Time (din)": "Lead Time (days)",
  "Abhi koi item is vendor se linked nahi hai.": "No items are linked to this vendor yet.",
  "Hata nahi paya.": "Could not be removed.",
  "Band karein": "Close",
  "Vendor nahi mila.": "Vendor not found.",
  "Link nahi mila.": "Link not found.",
  "Koi vendor linked nahi": "No vendor linked",
  "Price nahi hai": "No price set",
  "aur vendor": "more",
  "Items": "Items",
  "Item": "Item",
  "Unit Price": "Unit Price",
  "Suggested Vendor": "Suggested Vendor",

  // --- purchase flow (Indent Approve -> PO Issue -> Follow Up -> Material Received) ---
  "Purchase": "Purchase",
  "Indent Approve ke baad ka flow — PO Issue, Follow Up, aur Material Received.":
    "The flow after Indent Approve — PO Issue, Follow Up, and Material Received.",
  "PO Issue": "PO Issue",
  "Follow Up": "Follow Up",
  "Material Received": "Material Received",
  "Purchase — Setup": "Purchase — Setup",
  "Purchase Setup load nahi ho paya.": "Purchase Setup could not be loaded.",
  "Purchase Setup save ho gaya.": "Purchase Setup saved.",
  "Purchase Setup load ho raha hai": "Loading Purchase Setup",
  "Indent Approve se Material Received tak — har step ka Doer aur (jahan lagu ho) TAT set karein. Step 3 aur 4 ka time vendor ke Lead Time se khud ban jaata hai.":
    "From Indent Approve to Material Received — set a Doer and (where it applies) a TAT for each step. Steps 3 and 4's timing is derived automatically from the vendor's own Lead Time.",
  "Indent Approve": "Indent Approve",
  "Time = PO Issue ka actual time + Vendor ka Lead Time − 1 din.":
    "Time = PO Issue's actual completion time + the vendor's Lead Time − 1 day.",
  "Time = PO Issue ka actual time + Vendor ka poora Lead Time.":
    "Time = PO Issue's actual completion time + the vendor's full Lead Time.",
  "Candidates load nahi ho paye.": "Candidates could not be loaded.",
  "Candidates load ho rahe hain": "Loading candidates",
  "Abhi koi Approved indent nahi hai": "No Approved indents yet",
  "Indent Approve hote hi wo yahan PO ke liye aa jaayega.":
    "Once an indent is Approved, it will show up here for a PO.",
  "Vendor": "Vendor",
  "Vendor chunein": "Choose a vendor",
  "Vendor select karein": "Select a vendor",
  "Koi bhi Approved indent ka item kisi vendor se linked nahi hai — pehle Parties me Vendor ↔ Item link karein.":
    "No Approved indent's item is linked to any vendor yet — link a Vendor ↔ Item first from Parties.",
  "Ye vendor is list ke kisi item ko supply nahi karta.":
    "This vendor doesn't supply any item on this list.",
  "Old Price": "Old Price",
  "New Price": "New Price",
  "PO Attachment": "PO Attachment",
  "item chuna": "item chosen",
  "PO Issue karein": "Issue PO",
  "Kam se kam ek item chunein.": "Choose at least one item.",
  "PO attachment zaroori hai.": "A PO attachment is required.",
  "PO list load nahi ho payi.": "The PO list could not be loaded.",
  "PO list load ho rahi hai": "Loading the PO list",
  "Abhi koi Follow-up pending nahi hai": "No Follow-up is pending yet",
  "PO Issue hote hi wo yahan follow-up ke liye aa jaayega.":
    "Once a PO is issued, it will show up here for follow-up.",
  "Due": "Due",
  "Jaise: Vendor ne bola X date tak aa jaayega": "e.g. Vendor said it'll arrive by X date",
  "Follow-up Done": "Follow-up Done",
  "Follow-up complete ho gaya.": "Follow-up completed.",
  "Ordered": "Ordered",
  "Received": "Received",
  "Receive": "Receive",
  "Invoice": "Invoice",
  "Invoice dekhein": "View invoice",
  "Lead Time due": "Lead Time due",
  "Abhi koi PO receiving ke liye ready nahi hai": "No PO is ready for receiving yet",
  "Follow-up complete hote hi PO yahan receiving ke liye aa jaayega.":
    "Once follow-up is complete, the PO will show up here for receiving.",
  "Receive ho gaya — stock me jud gaya.": "Received — added to stock.",

  // --- nav, page titles, shared misc --------------------------------------------------
  "BOM": "BOM",
  "Inventory": "Inventory",
  "Indents": "Indents",
  "Production Planning": "Production Planning",
  "Reports": "Reports",
  "Tasks": "Tasks",
  "Platform": "Platform",
  "Inward & IQC": "Inward & IQC",
  "Team Performance": "Team Performance",
  "Excel export": "Export to Excel",
  "Share": "Share",
  "Copy": "Copy",
  "sirf aapka kaam": "only your own work",
  "Item ya SKU search karein": "Search by name or SKU",
  "Items load nahi ho paaye": "Items could not be loaded",
  "Guidebook": "Guidebook",
  "topics": "topics",
  "Guidebook contents": "Guidebook contents",
  "Contents": "Contents",
  "Settings": "Settings",
  "Theme": "Theme",
  "Colour": "Colour",
  "Language": "Language",
  "Is organization ka saara data — users, tasks, inventory, sab kuch — permanently delete ho jaayega. Uske users login nahi kar payenge aur unke email dobara istemaal ho sakenge. Ye wapas nahi aata.":
    "All of this organization's data — users, tasks, inventory, everything — will be permanently deleted. Its users will no longer be able to log in, and their emails will become available for reuse. This cannot be undone.",

  // --- leave system ------------------------------------------------------------------
  "Leave": "Leave",
  "Apni leave apply karein — approve hote hi, jitne din leave hai utne din aapke pending Tasks aur FMS steps aapke buddy ke naam chale jaayenge.":
    "Apply for your leave — once approved, your pending Tasks and FMS steps move to your buddy for however many days the leave lasts.",
  "Meri Leaves": "My Leaves",
  "Approvals": "Approvals",
  "Leave ke liye Apply karein": "Apply for Leave",
  "Leave Apply karein": "Apply for Leave",
  "Buddy chunein jo aapki leave ke dauraan aapke pending Tasks aur FMS steps sambhalega — approve hote hi aur leave shuru hote hi wo unke naam ho jaayenge, leave khatam hote hi wapas aapke.":
    "Choose a buddy to cover your pending Tasks and FMS steps during your leave — once approved and the leave starts, those move to them; once it ends, they come back to you.",
  "Leave Type": "Leave Type",
  "Casual": "Casual",
  "Sick": "Sick",
  "Earned": "Earned",
  "Other": "Other",
  "Buddy": "Buddy",
  "Buddy chunein": "Choose a buddy",
  "Start Date": "Start Date",
  "End Date": "End Date",
  "Reason": "Reason",
  "Apply karein": "Apply",
  "Leave file nahi ho payi.": "The leave could not be filed.",
  "Leave file ho gayi.": "Leave filed.",
  "Leaves load nahi ho paye.": "Leaves could not be loaded.",
  "Leaves load ho rahe hain": "Loading leaves",
  "Abhi koi leave nahi hai": "No leaves yet",
  "Apply karne par yahan dikhegi.": "It will show up here once you apply.",
  "Emergency — file kiya": "Emergency — filed by",
  "Buddy ko kaam mil chuka hai": "Buddy already has the work",
  "Cancel": "Cancel",
  "Leave cancel karein?": "Cancel this leave?",
  "Agar buddy ko kaam mil chuka hai to wo turant wapas ho jaayega.": "If the buddy already has the work, it will move back immediately.",
  "Haan, cancel karein": "Yes, cancel it",
  "Cancel nahi ho paya.": "Could not cancel.",
  "Leave cancel ho gayi.": "Leave cancelled.",
  "Emergency Leave File Karein": "File Emergency Leave",
  "Emergency Leave — HR": "Emergency Leave — HR",
  "Jab doer khud leave file nahi kar sakta — unke liye aur unka buddy, dono yahan se chunein.":
    "For when the doer can't file it themselves — choose both them and their buddy here.",
  "Doer chunein": "Choose a doer",
  "File karein": "File",
  "Emergency Leave file ho gayi.": "Emergency Leave filed.",
  "Approvals load nahi ho paye.": "Approvals could not be loaded.",
  "Approvals load ho rahe hain": "Loading approvals",
  "Abhi koi leave aapke approval ka wait nahi kar rahi": "No leave is waiting on your approval right now",
  "Jab koi leave aapke step tak pahunchegi, wo yahan dikhegi.": "When a leave reaches your step, it will show up here.",
  "Dates": "Dates",
  "Emergency": "Emergency",
  "Optional remark": "Optional remark",
  "Approve": "Approve",
  "Reject": "Reject",
  "Decision save nahi hua.": "The decision could not be saved.",
  "Leave approve ho gayi.": "Leave approved.",
  "Leave reject ho gayi.": "Leave rejected.",
  "Leave — Approval Setup": "Leave — Approval Setup",
  "Leave file hone ke baad kis-kis se approval chahiye, kis order me — ek step ho ya kai. 'Reporting Manager' har doer ke liye alag resolve hoga (unki apni profile me set); 'Specific person' hamesha wahi ek fixed insaan hoga (jaise HR, MD).":
    "Who has to approve a leave once it's filed, and in what order — one step or several. 'Reporting Manager' resolves differently per doer (set on their own profile); 'Specific person' is always the same one fixed person (e.g. HR, MD).",
  "Leave Approval Setup load nahi ho paya.": "Leave Approval Setup could not be loaded.",
  "Leave Approval Setup load ho raha hai": "Loading Leave Approval Setup",
  "Koi step nahi hai — is org me leave requests seedhe approve ho jaayengi, kisi approval ka wait nahi hoga.":
    "There are no steps — in this org, leave requests approve immediately, with no approval to wait on.",
  "Reporting Manager": "Reporting Manager",
  "Specific person": "Specific person",
  "Har 'Specific person' step ke liye ek user chunein.": "Choose a user for every 'Specific person' step.",
  "Leave approval chain me 'Reporting Manager' step yahi resolve hota hai.":
    "This is what the Leave approval chain's 'Reporting Manager' step resolves to.",

  // --- changelog ("what's new") -----------------------------------------------------
  "Naye updates": "What's new",
  "Inward ab Vendor Master se juda hai": "Inward is now linked to the Vendor Master",
  "Inward entry ka Party Name ab free text nahi — Vendor Master se chuna jaata hai, jaisa Purchase FMS me pehle se hota hai.":
    "An inward entry's Party Name is no longer free text — it's chosen from the Vendor Master, the same way Purchase FMS already does it.",
  "Production plan ab sirf apni chuni hui Line start karta hai":
    "A production plan now starts only its own chosen Line",
  "Start Production dabate hi sirf plan ki apni Line chalti hai — pehle jaisa har Active Line ko ek saath try karna band ho gaya.":
    "Pressing Start Production now runs only the plan's own Line — it no longer tries every Active Line at once the way it used to.",
  "BOM save karte hi uska product Items master me ban jaata hai":
    "Saving a BOM now creates its product in the Items master",
  "Kisi product ki pehli BOM save hote hi uska Item apne aap ban jaata hai — ab production ke waqt 'SKU nahi mila' wali error nahi aayegi.":
    "The first time a product's BOM is saved, its Item is created automatically — production no longer fails with a 'SKU not found' error.",
  "Holiday List ab Admin khud manage kar sakta hai": "Admin can now manage the Holiday List directly",
  "Settings me ab Holiday List add, edit, delete aur bulk import (Excel/CSV) se seedha manage hoti hai.":
    "The Holiday List in Settings can now be added to, edited, deleted, and bulk-imported (Excel/CSV) directly.",
  "WhatsApp message ab sahi number par jaata hai": "WhatsApp messages now reach the right number",
  "Bina '91' wale 10-digit number par bhi Task aur FMS ke WhatsApp message ab sahi se pahunchte hain.":
    "Task and FMS WhatsApp messages now reach a 10-digit number even without a leading '91'.",
  "Purchase FMS shuru se aakhir tak": "Purchase FMS, start to finish",
  "Indent Approve se PO Issue, Follow Up aur Material Received tak — poora Purchase flow ab system me hai.":
    "From Indent Approve through PO Issue, Follow Up, and Material Received — the whole Purchase flow is now in the system.",
  "Finished Goods ka apna alag page": "Finished Goods has its own page",
  "Finished Goods ab Inventory se alag apne page par dikhta hai, taaki raw material ke saath mix na ho.":
    "Finished Goods now shows on its own page, separate from Inventory, so it never mixes with raw material.",
  "Leave (buddy system) jud gaya": "Leave (buddy system) has been added",
  "Ab leave apply, approval chain se paas, aur chhutti ke dauraan tasks/FMS steps ka buddy ko automatic reassignment — sab ek jagah.":
    "Filing leave, getting it approved through a chain, and having your tasks/FMS steps automatically reassign to your buddy while you're away — all in one place now.",
  "Upar ka nav bar groups me bant gaya": "The top nav bar is now grouped",
  "Menu ab MDO, PMS, Stock, FMS aur Others groups me bant gaya hai, taaki roz ke kaam aur setup wale link mix na hon.":
    "The menu is now grouped into MDO, PMS, Stock, FMS, and Others, so day-to-day links and setup links never sit mixed together.",

  // --- leads and quotations ----------------------------------------------------------
  "Quotation Setup load nahi ho paya.": "Quotation Setup could not be loaded.",
  "Quotation Setup save ho gaya.": "Quotation Setup saved.",
  "Quotation Setup load ho raha hai": "Loading Quotation Setup",
  "Quotation — Setup": "Quotation — Setup",
  "Quotation PDF ke letterhead aur defaults — company/bank details, subject/note/terms, GST%, aur quotation number series.":
    "Letterhead and defaults for the quotation PDF — company/bank details, subject/note/terms, GST%, and the quotation number series.",
  "Pehla quotation number": "First quotation number",
  "Lead punch ho gaya.": "Lead punched in.",
  "+ Naya Lead": "+ New Lead",
  "Naya Lead Punch Karein": "Punch In a New Lead",
  "Sirf naam zaroori hai — baaki jo pata ho wo bhar dein.":
    "Only the name is required — fill in whatever else you know.",
  "Punch karein": "Punch in",
  "Lead load nahi ho paya.": "The lead could not be loaded.",
  "Quotation ban gaya.": "Quotation created.",
  "Details aur pipeline action": "Details and pipeline action",
  "Abhi koi activity nahi hai.": "There is no activity yet.",
  "Kholein": "Open",
  "Quotation Banayein": "Create Quotation",
  "Order Confirmed ho gaya — is lead se quotation accept ho chuka hai.":
    "Order Confirmed — a quotation from this lead has been accepted.",
  "Lost Mark Karein": "Mark Lost",
  "Qualify Karein": "Qualify",
  "Follow-up Log Karein": "Log Follow-up",
  "Agli Follow-up Date/Time": "Next Follow-up Date/Time",
  "Save karein": "Save",
  "Meeting Schedule Karein": "Schedule Meeting",
  "Schedule karein": "Schedule",
  "Nayi Date/Time": "New Date/Time",
  "Note Save Karein": "Save Note",
  "Leads load nahi ho paye.": "Leads could not be loaded.",
  "Leads load ho rahe hain": "Loading leads",
  "Abhi koi lead nahi hai": "There are no leads yet",
  "Naya lead punch karein ya bulk import se le aayein.": "Punch in a new lead, or bring several in via bulk import.",
  "Agla Follow-up / Meeting": "Next Follow-up / Meeting",
  "Lead punch/import se le kar Qualify, Follow-up, Meeting, Negotiation aur Quotation tak — poora sales pipeline.":
    "From punching in or importing a lead through Qualify, Follow-up, Meeting, Negotiation and Quotation — the whole sales pipeline.",
  "Header, line items aur totals — Draft me jitni baar chahe badla ja sakta hai.":
    "Header, line items and totals — can be changed as many times as needed while it's a Draft.",
  "Quotation load nahi ho paya.": "The quotation could not be loaded.",
  "Ye quantity samajh nahi aayi — sirf number ya formula (+ - * / ( )) likhein.":
    "That quantity wasn't understood — enter a plain number or a formula (+ - * / ( )).",
  "Draft save ho gaya.": "Draft saved.",
  "Ho gaya.": "Done.",
  "Quotation load ho raha hai": "Loading quotation",
  "Draft Save Karein": "Save Draft",
  "Bhej Dein (Send)": "Send",
  "Accepted Mark Karein": "Mark Accepted",
  "Rejected Mark Karein": "Mark Rejected",
  "Ye quotation Accept ho chuka hai — ab edit nahi ho sakta, sirf PDF dobara download ho sakta hai.":
    "This quotation has been Accepted — it can no longer be edited, only the PDF can be downloaded again.",
  "khaali chhodein agar billing jaisa hi hai": "leave blank if same as billing",
  "+ Line Add Karein": "+ Add Line",
  "Pipeline": "Pipeline",
  "Quotations load nahi ho payi.": "Could not load quotations.",
  "Quotations load ho rahi hain": "Loading quotations",
  "Abhi koi Quotation nahi hai": "No quotations yet",
  "Kisi Lead ko Negotiation stage me le jaakar, ya seedha 'Nayi Quotation' se banayein.":
    "Take a Lead to the Negotiation stage, or start one directly with 'New Quotation'.",
  "Quotation No": "Quotation No",
  "Payable": "Payable",
  "Bani": "Created",
  "walk-in": "walk-in",
  "Ek Customer chunein.": "Choose a Customer.",
  "Customer ka naam zaroori hai.": "Customer name is required.",
  "+ Nayi Quotation": "+ New Quotation",
  "Nayi Quotation (bina Lead ke)": "New Quotation (without a Lead)",
  "Koi purana Customer chunein, ya naya Customer bana kar seedha quotation shuru karein.":
    "Pick an existing Customer, or add a new one and start the quotation right away.",
  "Existing Customer": "Existing Customer",
  "New Customer": "New Customer",
  "Naam ya phone se search karein...": "Search by name or phone...",
  "Aapke naam se koi Customer nahi mila — New Customer tab try karein.":
    "No Customer found under your name — try the New Customer tab.",
  "Quotation Shuru Karein": "Start Quotation",
};
