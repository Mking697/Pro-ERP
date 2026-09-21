import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { QuotationRecord } from "@/lib/leads/quotations";
import type { QuotationSetupConfig } from "@/lib/leads/quotationSetup";

/**
 * The quotation PDF, drawn with @react-pdf/renderer rather than by printing HTML — that
 * would need a headless-Chromium binary to run on the server, which Vercel has no slot
 * for. This is plain JavaScript that runs anywhere Node runs. Layout adapted from a
 * reference CRM's own quotation-pdf.tsx (A4 landscape, header/letterhead, party box,
 * line-item table, totals, terms, bank details, signature), re-columned for Pro-ERP's own
 * generic line-item shape (Particular/Specification/Description/UOM/Qty/Rate/Amount)
 * rather than that reference's panel-industry-specific columns.
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
    paddingTop: 18,
    paddingBottom: 28,
    paddingHorizontal: 18,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: COLORS.ink,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.line,
    paddingBottom: 8,
    marginBottom: 8,
  },
  headerLeft: { flexDirection: "row", gap: 10, flexGrow: 1, flexShrink: 1 },
  logo: { width: 46, height: 46, objectFit: "contain" },
  companyName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  companyLine: { fontSize: 7.5, color: COLORS.muted, marginTop: 1.5 },
  headerRight: { alignItems: "flex-end", width: 160 },
  docTitle: { fontSize: 15, fontFamily: "Helvetica-Bold" },

  boxes: { flexDirection: "row", gap: 8, marginBottom: 8 },
  box: { flexGrow: 1, flexBasis: 0, borderWidth: 0.75, borderColor: COLORS.line, padding: 6 },
  boxTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  boxLine: { fontSize: 8, marginBottom: 1.5 },

  subject: { borderWidth: 0.75, borderColor: COLORS.line, padding: 6, marginBottom: 8 },

  table: { borderWidth: 0.75, borderColor: COLORS.line },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COLORS.line },
  trLast: { flexDirection: "row" },
  th: {
    backgroundColor: COLORS.headBg,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    padding: 4,
    borderRightWidth: 0.5,
    borderRightColor: COLORS.line,
    textAlign: "center",
  },
  td: { fontSize: 7.5, padding: 4, borderRightWidth: 0.5, borderRightColor: COLORS.line },

  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  totals: { width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, paddingHorizontal: 6 },
  totalRowStrong: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: COLORS.totalBg,
    borderWidth: 0.75,
    borderColor: COLORS.line,
    marginTop: 2,
  },

  section: { marginTop: 10 },
  sectionTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  body: { fontSize: 7.5, color: COLORS.muted, lineHeight: 1.45 },

  bank: { marginTop: 10, borderWidth: 0.75, borderColor: COLORS.line, padding: 6 },
  bankGrid: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  bankCell: { width: "33%", fontSize: 7.5, marginBottom: 1.5 },

  signature: { marginTop: 26, alignItems: "flex-end" },

  footer: {
    position: "absolute",
    bottom: 12,
    left: 18,
    right: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 6.5,
    color: COLORS.faint,
  },
});

/** Column widths as percentages, adding up to 100. */
const COLS = [
  { key: "sno", label: "S.No", width: "5%", align: "center" as const },
  { key: "particular", label: "Particular", width: "15%", align: "left" as const },
  { key: "specification", label: "Specification", width: "12%", align: "left" as const },
  { key: "description", label: "Description", width: "28%", align: "left" as const },
  { key: "uom", label: "UOM", width: "6%", align: "center" as const },
  { key: "qty", label: "Qty", width: "8%", align: "right" as const },
  { key: "rate", label: "Rate", width: "12%", align: "right" as const },
  { key: "amount", label: "Amount", width: "14%", align: "right" as const },
];

function QuotationDocument({
  quotation,
  setup,
  logoUrl,
  dateText,
  validText,
}: {
  quotation: QuotationRecord;
  setup: QuotationSetupConfig;
  logoUrl: string;
  dateText: string;
  validText: string | null;
}) {
  const shippingSameAsBilling = !quotation.shippingAddress && !quotation.shippingCity;

  return (
    <Document
      title={`Quotation ${quotation.quotationNo} - ${quotation.partyName}`}
      author={setup.companyName || "Pro ERP"}
      subject={quotation.subject}
    >
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
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
            <Text style={styles.docTitle}>Quotation</Text>
            <Text style={styles.companyLine}>Reference: {quotation.quotationNo}</Text>
            <Text style={styles.companyLine}>Date: {dateText}</Text>
            {validText ? <Text style={styles.companyLine}>Valid to: {validText}</Text> : null}
          </View>
        </View>

        <View style={styles.boxes}>
          <View style={styles.box}>
            <Text style={styles.boxTitle}>To</Text>
            <Text style={[styles.boxLine, { fontFamily: "Helvetica-Bold" }]}>{quotation.partyName}</Text>
            {quotation.contactPerson ? (
              <Text style={styles.boxLine}>Kind Attn: {quotation.contactPerson}</Text>
            ) : null}
            <Text style={styles.boxLine}>
              {[
                quotation.customerMobile ? `Mobile: ${quotation.customerMobile}` : null,
                quotation.customerEmail ? `Email: ${quotation.customerEmail}` : null,
              ]
                .filter(Boolean)
                .join("  |  ") || " "}
            </Text>
            <Text style={styles.boxLine}>
              {[quotation.billingAddress, [quotation.billingCity, quotation.billingState].filter(Boolean).join(", "), quotation.billingPincode]
                .filter((line) => line && line.trim())
                .join("\n")}
            </Text>
            {quotation.customerGst ? <Text style={styles.boxLine}>GST: {quotation.customerGst}</Text> : null}
          </View>

          <View style={styles.box}>
            <Text style={styles.boxTitle}>Delivery address</Text>
            {shippingSameAsBilling ? (
              <Text style={styles.boxLine}>Same as billing address</Text>
            ) : (
              <>
                {quotation.shippingPartyName ? (
                  <Text style={[styles.boxLine, { fontFamily: "Helvetica-Bold" }]}>
                    {quotation.shippingPartyName}
                  </Text>
                ) : null}
                {quotation.shippingContactPerson ? (
                  <Text style={styles.boxLine}>Kind Attn: {quotation.shippingContactPerson}</Text>
                ) : null}
                <Text style={styles.boxLine}>
                  {[
                    quotation.shippingAddress,
                    [quotation.shippingCity, quotation.shippingState].filter(Boolean).join(", "),
                    quotation.shippingPincode,
                  ]
                    .filter((line) => line && line.trim())
                    .join("\n")}
                </Text>
              </>
            )}
          </View>
        </View>

        {quotation.subject ? (
          <View style={styles.subject}>
            <Text style={styles.boxTitle}>Subject</Text>
            <Text style={{ fontSize: 8 }}>{quotation.subject}</Text>
          </View>
        ) : null}

        <View style={styles.table}>
          <View style={styles.tr} fixed>
            {COLS.map((col) => (
              <Text key={col.key} style={[styles.th, { width: col.width }]}>
                {col.label}
              </Text>
            ))}
          </View>

          {quotation.items.map((item, index) => (
            <View
              key={item.lineNo}
              style={index === quotation.items.length - 1 ? styles.trLast : styles.tr}
              wrap={false}
            >
              <Text style={[styles.td, { width: COLS[0]!.width, textAlign: "center" }]}>{index + 1}</Text>
              <Text style={[styles.td, { width: COLS[1]!.width }]}>{item.particular}</Text>
              <Text style={[styles.td, { width: COLS[2]!.width }]}>{item.specification}</Text>
              <Text style={[styles.td, { width: COLS[3]!.width }]}>{item.description}</Text>
              <Text style={[styles.td, { width: COLS[4]!.width, textAlign: "center" }]}>{item.uom}</Text>
              <Text style={[styles.td, { width: COLS[5]!.width, textAlign: "right" }]}>
                {formatQty(item.qty)}
              </Text>
              <Text style={[styles.td, { width: COLS[6]!.width, textAlign: "right" }]}>
                {formatMoney(item.rate)}
              </Text>
              <Text
                style={[styles.td, { width: COLS[7]!.width, textAlign: "right", borderRightWidth: 0 }]}
              >
                {formatMoney(item.amount)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsWrap} wrap={false}>
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text>Sub total</Text>
              <Text>{formatMoney(quotation.subTotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>Freight charges</Text>
              <Text>{formatMoney(quotation.freightAmount)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>GST {quotation.gstPercent}%</Text>
              <Text>{formatMoney(quotation.gstAmount)}</Text>
            </View>
            <View style={styles.totalRowStrong}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Payable amount</Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{formatMoney(quotation.payableAmount)}</Text>
            </View>
          </View>
        </View>

        {quotation.note ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Note</Text>
            <Text style={styles.body}>{quotation.note}</Text>
          </View>
        ) : null}

        {quotation.terms ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Terms &amp; Conditions</Text>
            <Text style={styles.body}>{quotation.terms}</Text>
          </View>
        ) : null}

        {setup.bankBeneficiary || setup.bankAccountNo ? (
          <View style={styles.bank} wrap={false}>
            <Text style={styles.sectionTitle}>Beneficiary: {setup.bankBeneficiary}</Text>
            <View style={styles.bankGrid}>
              <Text style={styles.bankCell}>Bank: {setup.bankName}</Text>
              <Text style={styles.bankCell}>Account no.: {setup.bankAccountNo}</Text>
              <Text style={styles.bankCell}>IFSC: {setup.bankIfsc}</Text>
              <Text style={styles.bankCell}>Branch: {setup.bankBranch}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.signature} wrap={false}>
          <Text style={{ fontSize: 8 }}>(Authorised Signatory)</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {quotation.quotationNo} &middot; {quotation.partyName}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderQuotationPdfBuffer(
  quotation: QuotationRecord,
  setup: QuotationSetupConfig,
  logoUrl: string,
  dateText: string,
  validText: string | null
): Promise<Buffer> {
  return renderToBuffer(
    <QuotationDocument
      quotation={quotation}
      setup={setup}
      logoUrl={logoUrl}
      dateText={dateText}
      validText={validText}
    />
  );
}
