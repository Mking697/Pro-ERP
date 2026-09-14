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
  "Inventory ki sheets abhi connect nahi hui": "Inventory sheets are not connected yet",
  "Inventory sheets connect nahi hui": "Inventory sheets are not connected",
  "Har item ka live stock. Stock kahin store nahi hota — har baar In/Out entries se nikala jaata hai.":
    "Live stock for every item. Stock is never stored — it is worked out from the In and Out entries every time.",
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
  "Google Sheets, Drive, aur WhatsApp connections manage karein.":
    "Manage Google Sheets, Drive and WhatsApp connections.",
  "Har sheet aur Drive folder is address ke saath":
    "Share every sheet and Drive folder with this address",
  "Settings kholein": "Open Settings",
  "Settings load nahi ho payi.": "Could not load settings.",
  "Sheet connections load ho rahi hain": "Loading sheet connections",
  "Connect ho gaya.": "Connected.",
  "Pehle URL daalein.": "Enter a URL first.",
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
  "Items sheet connect nahi hai": "The Items sheet is not connected",
  "PPC ke liye Production Plans aur Plan Materials — dono sheet chahiye.":
    "PPC needs both sheets: Production Plans and Plan Materials.",
  "Ye page usi sheet se padhta hai. Settings me uska URL paste karte hi yahan data aane lagega.":
    "This page reads from that sheet. Paste its URL in Settings and the data will appear here.",

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
  "Ye link kisi folder ka nahi hai.": "That link does not point to a folder.",
  "Is folder tak access nahi mil paya. Folder ko service account email ke saath Editor access se share karein.":
    "Could not reach that folder. Share it with the service account email, with Editor access.",
  "Ye folder ek personal Google Drive me hai. Service account personal Drive me file nahi rakh sakta (Google ki limitation), isliye attachments yahan upload nahi honge. Folder ko ek Shared Drive ke andar banayein aur service account ko Content Manager access dein.":
    "That folder is in a personal Google Drive. A service account cannot store files in a personal Drive — this is Google's own limitation, not ours — so attachments will not upload there. Create the folder inside a Shared Drive and give the service account Content Manager access.",
  "Is folder me file upload nahi ho payi.":
    "The file could not be uploaded to that folder.",
  "File storage abhi configure nahi hui hai. Admin > Settings me apna Drive folder connect karein, ya platform administrator se kahein ki blob storage set karein.":
    "File storage is not configured yet. Connect your Drive folder under Admin > Settings, or ask the platform administrator to set up blob storage.",
  "Ye Drive folder ek personal Google Drive me hai, isliye file upload nahi ho sakti. Folder ko Shared Drive me banayein, ya platform administrator se blob storage set karwayein.":
    "This Drive folder is in a personal Google Drive, so files cannot be uploaded to it. Create the folder in a Shared Drive, or ask the platform administrator to set up blob storage.",
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
  "Is organization ki tenancy khatam ho jaayegi: uske users login nahi kar payenge aur unke email dobara istemaal ho sakenge. Unki apni Google Sheets ko haath nahi lagaya jaata — wo data unka hai.":
    "This ends the organization's tenancy: its users can no longer sign in and their emails become available again. Its own Google Sheets are left untouched — that data belongs to them.",
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
};
