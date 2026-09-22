import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/**
 * The payslip PDF — same tooling and money-formatting convention as
 * src/lib/leads/quotationPdf.tsx (@react-pdf/renderer, no headless-Chromium dependency;
 * "Rs." rather than the rupee glyph, which Helvetica has no glyph for). Deliberately much
 * simpler than the quotation document: one employee, one month, no line items.
 */

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

function formatMonth(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${names[(monthNum ?? 1) - 1] ?? month} ${year ?? ""}`.trim();
}

const COLORS = {
  ink: "#1a1a1a",
  muted: "#555555",
  line: "#000000",
  headBg: "#eeeeee",
  totalBg: "#fff8dc",
};

const styles = StyleSheet.create({
  page: {
    padding: 28,
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
    marginBottom: 14,
  },
  headerLeft: { flexDirection: "row", gap: 10, alignItems: "center" },
  logo: { width: 40, height: 40, objectFit: "contain" },
  companyName: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docSub: { fontSize: 9, color: COLORS.muted, textAlign: "right", marginTop: 2 },

  box: { borderWidth: 0.75, borderColor: COLORS.line },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.line,
  },
  rowLast: { flexDirection: "row" },
  cellLabel: {
    width: "40%",
    backgroundColor: COLORS.headBg,
    fontFamily: "Helvetica-Bold",
    padding: 6,
    borderRightWidth: 0.5,
    borderRightColor: COLORS.line,
  },
  cellValue: { width: "60%", padding: 6 },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 8,
    backgroundColor: COLORS.totalBg,
    borderWidth: 0.75,
    borderColor: COLORS.line,
    marginTop: 12,
  },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  totalValue: { fontFamily: "Helvetica-Bold", fontSize: 10 },

  note: { marginTop: 16, fontSize: 7.5, color: COLORS.muted, lineHeight: 1.4 },
});

export interface PayslipPdfInput {
  companyName: string;
  logoUrl: string;
  month: string;
  employeeName: string;
  monthlySalary: number;
  daysInMonth: number;
  daysEmployed: number;
  grossPay: number;
  netPay: number;
}

function PayslipDocument({ input }: { input: PayslipPdfInput }) {
  const monthText = formatMonth(input.month);
  return (
    <Document title={`Payslip ${monthText} - ${input.employeeName}`} author={input.companyName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {input.logoUrl ? <Image src={input.logoUrl} style={styles.logo} /> : null}
            <Text style={styles.companyName}>{input.companyName}</Text>
          </View>
          <View>
            <Text style={styles.docTitle}>Payslip</Text>
            <Text style={styles.docSub}>{monthText}</Text>
          </View>
        </View>

        <View style={styles.box}>
          <View style={styles.row}>
            <Text style={styles.cellLabel}>Employee</Text>
            <Text style={styles.cellValue}>{input.employeeName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cellLabel}>Month</Text>
            <Text style={styles.cellValue}>{monthText}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cellLabel}>Monthly Salary</Text>
            <Text style={styles.cellValue}>{formatMoney(input.monthlySalary)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cellLabel}>Days Employed / Days in Month</Text>
            <Text style={styles.cellValue}>
              {input.daysEmployed} / {input.daysInMonth}
            </Text>
          </View>
          <View style={styles.rowLast}>
            <Text style={styles.cellLabel}>Gross Pay</Text>
            <Text style={styles.cellValue}>{formatMoney(input.grossPay)}</Text>
          </View>
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Net Pay</Text>
          <Text style={styles.totalValue}>{formatMoney(input.netPay)}</Text>
        </View>

        <Text style={styles.note}>
          This is a simplified payslip. No statutory deductions (PF/ESI/TDS) are included in
          this version.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPayslipPdfBuffer(input: PayslipPdfInput): Promise<Buffer> {
  return renderToBuffer(<PayslipDocument input={input} />);
}
