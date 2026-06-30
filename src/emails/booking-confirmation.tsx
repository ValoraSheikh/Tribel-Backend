import {
  Body,
  Container,
  Column,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";

type BookingConfirmationEmailProps = {
  guestName: string;
  propertyName: string;
  propertyImage: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyCountry: string;
  propertyPostalCode: string;
  propertyContactEmail: string;
  propertyContactPhone: string;
  gstin?: string;
  bookingId: string;
  checkIn: string;
  checkOut: string;
  amount: string;
  currency: string;
  currencySymbol: string;
  paymentId?: string;
  paymentMode: string;
};

export function BookingConfirmationEmail({
  guestName,
  propertyName,
  propertyImage,
  propertyAddress,
  propertyCity,
  propertyState,
  propertyCountry,
  propertyPostalCode,
  propertyContactEmail,
  propertyContactPhone,
  gstin,
  bookingId,
  checkIn,
  checkOut,
  amount,
  currency,
  currencySymbol,
  paymentId,
  paymentMode,
}: BookingConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your booking at {propertyName} is confirmed!</Preview>
      <Body style={body}>
        <Container style={container}>
          {propertyImage ? (
            <Img
              src={propertyImage}
              alt={propertyName}
              width="100%"
              height="auto"
              style={image}
            />
          ) : null}

          <Section style={content}>
            <Heading style={h1}>Booking Confirmed! 🎉</Heading>
            <Text style={greeting}>Hi {guestName},</Text>
            <Text style={paragraph}>
              Your booking at <strong>{propertyName}</strong> has been
              confirmed. Here are the details:
            </Text>

            <Section style={detailsSection}>
              <Row>
                <Column style={labelCol}>Booking ID</Column>
                <Column style={valueCol}>{bookingId}</Column>
              </Row>
              <Row>
                <Column style={labelCol}>Check-in</Column>
                <Column style={valueCol}>{checkIn}</Column>
              </Row>
              <Row>
                <Column style={labelCol}>Check-out</Column>
                <Column style={valueCol}>{checkOut}</Column>
              </Row>
              <Row>
                <Column style={labelCol}>Guest</Column>
                <Column style={valueCol}>{guestName}</Column>
              </Row>
              <Row>
                <Column style={labelCol}>Payment Mode</Column>
                <Column style={valueCol}>{paymentMode}</Column>
              </Row>
              {paymentId ? (
                <Row>
                  <Column style={labelCol}>Payment ID</Column>
                  <Column style={valueCol}>{paymentId}</Column>
                </Row>
              ) : null}
            </Section>

            <Hr style={hr} />

            <Section style={amountSection}>
              <Text style={amountLabel}>Total Amount</Text>
              <Text style={amountValue}>
                {currencySymbol}
                {amount} {currency}
              </Text>
            </Section>

            <Hr style={hr} />

            <Section style={propertySection}>
              <Heading as="h3" style={h3}>
                Property Details
              </Heading>
              <Text style={propertyNameStyle}>{propertyName}</Text>
              <Text style={addressText}>
                {propertyAddress}
                <br />
                {propertyCity}, {propertyState} {propertyPostalCode}
                <br />
                {propertyCountry}
              </Text>
              <Text style={contactText}>
                {propertyContactEmail} &bull; {propertyContactPhone}
              </Text>
              {gstin ? (
                <Text style={gstinText}>GSTIN: {gstin}</Text>
              ) : null}
            </Section>

            <Hr style={hr} />

            <Text style={footer}>
              This is an automated confirmation. If you have any questions,
              please contact the property directly.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily: "Arial, Helvetica, sans-serif",
  padding: "20px",
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  maxWidth: "580px",
  margin: "0 auto",
  overflow: "hidden",
};

const image: React.CSSProperties = {
  maxHeight: "280px",
  objectFit: "cover",
};

const content: React.CSSProperties = {
  padding: "32px 36px",
};

const h1: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: "700",
  color: "#18181b",
  margin: "0 0 8px",
};

const greeting: React.CSSProperties = {
  fontSize: "16px",
  color: "#27272a",
  margin: "0 0 8px",
};

const paragraph: React.CSSProperties = {
  fontSize: "15px",
  color: "#52525b",
  lineHeight: "1.6",
  margin: "0 0 20px",
};

const detailsSection: React.CSSProperties = {
  backgroundColor: "#fafafa",
  borderRadius: "6px",
  padding: "16px",
  margin: "0 0 16px",
};

const labelCol: React.CSSProperties = {
  fontSize: "13px",
  color: "#71717a",
  padding: "4px 12px 4px 0",
  width: "130px",
};

const valueCol: React.CSSProperties = {
  fontSize: "14px",
  color: "#18181b",
  fontWeight: "500",
  padding: "4px 0",
};

const hr: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "16px 0",
};

const amountSection: React.CSSProperties = {
  textAlign: "center",
  padding: "12px 0",
};

const amountLabel: React.CSSProperties = {
  fontSize: "13px",
  color: "#71717a",
  margin: "0 0 4px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const amountValue: React.CSSProperties = {
  fontSize: "28px",
  fontWeight: "700",
  color: "#18181b",
  margin: 0,
};

const h3: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: "600",
  color: "#18181b",
  margin: "0 0 12px",
};

const propertySection: React.CSSProperties = {
  padding: "0",
};

const propertyNameStyle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: "600",
  color: "#18181b",
  margin: "0 0 8px",
};

const addressText: React.CSSProperties = {
  fontSize: "14px",
  color: "#52525b",
  lineHeight: "1.6",
  margin: "0 0 8px",
};

const contactText: React.CSSProperties = {
  fontSize: "13px",
  color: "#71717a",
  margin: "0 0 4px",
};

const gstinText: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: "600",
  color: "#52525b",
  margin: "8px 0 0",
};

const footer: React.CSSProperties = {
  fontSize: "12px",
  color: "#a1a1aa",
  textAlign: "center",
  lineHeight: "1.5",
};

BookingConfirmationEmail.PreviewProps = {
  guestName: "Rahul Sharma",
  propertyName: "Zappotel Grand",
  propertyImage: "",
  propertyAddress: "123 MG Road",
  propertyCity: "Mumbai",
  propertyState: "Maharashtra",
  propertyCountry: "India",
  propertyPostalCode: "400001",
  propertyContactEmail: "grand@zappotel.com",
  propertyContactPhone: "+91 98765 43210",
  gstin: "27AABCG1234F1Z5",
  bookingId: "bkg_abc123xyz",
  checkIn: "15/07/2025",
  checkOut: "18/07/2025",
  amount: "4,500.00",
  currency: "INR",
  currencySymbol: "₹",
  paymentId: "pay_abc123xyz",
  paymentMode: "ONLINE",
} satisfies BookingConfirmationEmailProps;
