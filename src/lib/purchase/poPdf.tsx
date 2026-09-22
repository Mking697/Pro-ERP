import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { QuotationSetupConfig } from "@/lib/leads/quotationSetup";

/**
 * The Purchase Order PDF, drawn with @react-pdf/renderer — same reasoning and the same
 * visual language as src/lib/leads/quotationPdf.tsx (A4, header/letterhead, party box,
 * line-item table, totals, signature, footer), re-columned for a PO's own shape
 * (SKU/Item/UOM/Qty/Old Price/New Price/Amount) rather than a quotation's.
 *
 * Reuses Quotation Setup's own company-letterhead fields (name/address/GSTIN) rather than
 * adding a second "company details" settings screen — Purchase Setup itself only carries
 * Doer/TAT config, and a PO's own letterhead is the same company either way.
 */

// Helvetica (the built-in font) has no rupee glyph — written "Rs." instead, unambiguous on
// an Indian document and renders identically on every reader.
function formatMoney(amount: number): string {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const rupees = Math.trunc(absolute);
  const paise = Math.round((absolute - rupees) * 100);
  const digits = String(rupees);
  const grouped =
    digits.length <= 3
      ? digits
      : digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + digits.slice(-3);
  return `${negative ? "-" : ""}Rs. ${grouped}.${String(paise).padStart(2, "0")}`;
}

function formatQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000).replace(/\.0+$|(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

const COLORS = {
  ink: "#1a1a1a",
  muted: "#555555",
  faint: "#888888",
  line: "#000000",
  headBg: "#eeeeee",
  totalBg: "#fff8dc",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 32,
    paddingHorizontal: 24,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: COLORS.ink,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.line,
    paddingBottom: 10,
    marginBottom: 10,
  },
  headerLeft: { flexDirection: "row", gap: 10, flexGrow: 1, flexShrink: 1 },
  logo: { width: 50, height: 50, objectFit: "contain" },
  companyName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  companyLine: { fontSize: 8, color: COLORS.muted, marginTop: 1.5 },
  headerRight: { alignItems: "flex-end", width: 180 },
  docTitle: { fontSize: 16, fontFamily: "Helvetica-Bold" },

  box: { borderWidth: 0.75, borderColor: COLORS.line, padding: 7, marginBottom: 10 },
  boxTitle: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  boxLine: { fontSize: 9, marginBottom: 1.5 },

  table: { borderWidth: 0.75, borderColor: COLORS.line },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.line },
  trLast: { flexDirection: "row" },
  th: {
    backgroundColor: COLORS.headBg,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    padding: 4,
    borderRightWidth: 0.5,
    borderRightColor: COLORS.line,
    textAlign: "center",
  },
  td: { fontSize: 8.5, padding: 4, borderRightWidth: 0.5, borderRightColor: COLORS.line },

  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  totals: { width: 220 },
  totalRowStrong: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: COLORS.totalBg,
    borderWidth: 0.75,
    borderColor: COLORS.line,
  },

  note: { marginTop: 10, fontSize: 8, color: COLORS.muted },

  signature: { marginTop: 32, alignItems: "flex-end" },

  footer: {
    position: "absolute",
    bottom: 14,
    left: 24,
    right: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: COLORS.faint,
  },
});

/** Column widths as percentages, adding up to 100. */
const COLS = [
  { key: "sno", label: "S.No", width: "6%" },
  { key: "sku", label: "SKU", width: "14%" },
  { key: "item", label: "Item", width: "30%" },
  { key: "uom", label: "UOM", width: "8%" },
  { key: "qty", label: "Qty", width: "10%" },
  { key: "oldPrice", label: "Old Price", width: "12%" },
  { key: "newPrice", label: "New Price", width: "10%" },
  { key: "amount", label: "Amount", width: "10%" },
];

export interface PurchaseOrderPdfVendor {
  name: string;
  address: string;
  city: string;
  state: string;
  gstin: string;
  phone: string;
  email: string;
}

export interface PurchaseOrderPdfLine {
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  /** May be "" when the vendor link had no price on file yet. */
  oldPrice: string;
  newPrice: string;
}

export interface PurchaseOrderPdfData {
  /** The real PO_ID once issued, or a placeholder ("Draft") before Issue has been clicked —
   * see previewPoPdf() in orders.ts for why a pre-Issue render has no real id yet. */
  poId: string;
  vendor: PurchaseOrderPdfVendor;
  lines: PurchaseOrderPdfLine[];
}

function PurchaseOrderDocument({
  order,
  setup,
  logoUrl,
  dateText,
}: {
  order: PurchaseOrderPdfData;
  setup: QuotationSetupConfig;
  logoUrl: string;
  dateText: string;
}) {
  const total = order.lines.reduce(
    (sum, line) => sum + line.qty * (Number(line.newPrice) || 0),
    0
  );

  return (
    <Document
      title={`Purchase Order ${order.poId} - ${order.vendor.name}`}
      author={setup.companyName || "Pro ERP"}
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {/* @react-pdf/renderer's Image, not an HTML <img> — jsx-a11y's alt-text rule
                doesn't know the difference and flags it as if it were one. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}
            <View style={{ flexGrow: 1, flexShrink: 1 }}>
              <Text style={styles.companyName}>{setup.companyName || "-"}</Text>
              {setup.companyAddress ? <Text style={styles.companyLine}>{setup.companyAddress}</Text> : null}
              {setup.companyGstin ? <Text style={styles.companyLine}>GST: {setup.companyGstin}</Text> : null}
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.docTitle}>Purchase Order</Text>
            <Text style={styles.companyLine}>PO No: {order.poId}</Text>
            <Text style={styles.companyLine}>Date: {dateText}</Text>
          </View>
        </View>

        <View style={styles.box}>
          <Text style={styles.boxTitle}>Vendor</Text>
          <Text style={[styles.boxLine, { fontFamily: "Helvetica-Bold" }]}>{order.vendor.name}</Text>
          <Text style={styles.boxLine}>
            {[order.vendor.address, [order.vendor.city, order.vendor.state].filter(Boolean).join(", ")]
              .filter((line) => line && line.trim())
              .join("\n") || " "}
          </Text>
          <Text style={styles.boxLine}>
            {[
              order.vendor.gstin ? `GST: ${order.vendor.gstin}` : null,
              order.vendor.phone ? `Phone: ${order.vendor.phone}` : null,
              order.vendor.email ? `Email: ${order.vendor.email}` : null,
            ]
              .filter(Boolean)
              .join("  |  ") || " "}
          </Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tr} fixed>
            {COLS.map((col) => (
              <Text key={col.key} style={[styles.th, { width: col.width }]}>
                {col.label}
              </Text>
            ))}
          </View>

          {order.lines.map((line, index) => {
            const amount = line.qty * (Number(line.newPrice) || 0);
            return (
              <View
                key={`${line.sku}-${index}`}
                style={index === order.lines.length - 1 ? styles.trLast : styles.tr}
                wrap={false}
              >
                <Text style={[styles.td, { width: COLS[0]!.width, textAlign: "center" }]}>{index + 1}</Text>
                <Text style={[styles.td, { width: COLS[1]!.width }]}>{line.sku}</Text>
                <Text style={[styles.td, { width: COLS[2]!.width }]}>{line.itemName}</Text>
                <Text style={[styles.td, { width: COLS[3]!.width, textAlign: "center" }]}>{line.uom}</Text>
                <Text style={[styles.td, { width: COLS[4]!.width, textAlign: "right" }]}>
                  {formatQty(line.qty)}
                </Text>
                <Text style={[styles.td, { width: COLS[5]!.width, textAlign: "right" }]}>
                  {line.oldPrice ? formatMoney(Number(line.oldPrice)) : "-"}
                </Text>
                <Text style={[styles.td, { width: COLS[6]!.width, textAlign: "right" }]}>
                  {line.newPrice ? formatMoney(Number(line.newPrice)) : "-"}
                </Text>
                <Text
                  style={[styles.td, { width: COLS[7]!.width, textAlign: "right", borderRightWidth: 0 }]}
                >
                  {formatMoney(amount)}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.totalsWrap} wrap={false}>
          <View style={styles.totals}>
            <View style={styles.totalRowStrong}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Total</Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{formatMoney(total)}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.note}>
          Please acknowledge receipt of this Purchase Order and confirm the delivery schedule.
        </Text>

        <View style={styles.signature} wrap={false}>
          <Text style={{ fontSize: 9 }}>(Authorised Signatory)</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {order.poId} &middot; {order.vendor.name}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdfBuffer(
  order: PurchaseOrderPdfData,
  setup: QuotationSetupConfig,
  logoUrl: string,
  dateText: string
): Promise<Buffer> {
  return renderToBuffer(
    <PurchaseOrderDocument order={order} setup={setup} logoUrl={logoUrl} dateText={dateText} />
  );
}
