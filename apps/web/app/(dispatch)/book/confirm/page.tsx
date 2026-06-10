import { getEstimateById } from "@/lib/dispatch/price-estimator";

const TIER_LABELS: Record<string, string> = {
  simple: "Simple",
  moderate: "Moderate",
  complex: "Complex",
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  simple: "Routine repair, typically under 2 hours with standard parts.",
  moderate: "Skilled multi-step work, typically 2–6 hours with specialist parts.",
  complex: "Major repair or multi-day job requiring specialist expertise.",
};

function formatPrice(pence: number): string {
  return `$${pence.toLocaleString("en-US")}`;
}

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: { id?: string };
}) {
  const estimateId = searchParams.id ?? "";

  if (!estimateId) {
    return (
      <main>
        <h1>No estimate found</h1>
        <p>
          It looks like you arrived here directly. Please{" "}
          <a href="/book" className="btn secondary">
            start your booking
          </a>{" "}
          to get an instant price estimate.
        </p>
      </main>
    );
  }

  let estimate;
  try {
    estimate = await getEstimateById(estimateId);
  } catch {
    estimate = null;
  }

  if (!estimate) {
    return (
      <main>
        <h1>Estimate not found</h1>
        <p>
          We could not load your price estimate. Please{" "}
          <a href="/book" className="btn secondary">
            start a new booking
          </a>
          .
        </p>
      </main>
    );
  }

  const tierLabel = TIER_LABELS[estimate.complexity_tier] ?? estimate.complexity_tier;
  const tierDesc = TIER_DESCRIPTIONS[estimate.complexity_tier] ?? "";
  const categoryLabel =
    estimate.trade_category.charAt(0).toUpperCase() +
    estimate.trade_category.slice(1);

  return (
    <main>
      <h1>Your Instant Price Estimate</h1>
      <p>
        Our AI has analysed your photos and issue description to generate the
        estimate below. Review the details, then confirm your booking.
      </p>

      <div className="card">
        <h2>{categoryLabel} — {tierLabel} Job</h2>
        <p className="muted">{tierDesc}</p>

        <table>
          <tbody>
            <tr>
              <th scope="row">Service category</th>
              <td>{categoryLabel}</td>
            </tr>
            <tr>
              <th scope="row">Complexity</th>
              <td>{tierLabel}</td>
            </tr>
            <tr>
              <th scope="row">Estimated price range</th>
              <td>
                <strong>
                  {formatPrice(estimate.price_band_low)} –{" "}
                  {formatPrice(estimate.price_band_high)}
                </strong>
              </td>
            </tr>
            <tr>
              <th scope="row">Issue described</th>
              <td>{estimate.description}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <p>
          <strong>Non-binding estimate — important notice</strong>
        </p>
        <p className="muted">
          This estimate is generated automatically by an AI model based on the
          photos and description you provided. It is <em>not</em> a formal quote
          or guarantee of final price. Actual costs may vary depending on
          factors identified on-site by the attending tradesperson, including
          hidden damage, non-standard fittings, or additional materials
          required. The final price will be agreed between you and the
          tradesperson before any work begins. Nexus Dispatch accepts no
          liability for any discrepancy between this AI-generated estimate and
          the final invoice.
        </p>
      </div>

      <form method="post" action="/api/dispatch/bookings">
        <input type="hidden" name="estimate_id" value={estimate.id} />
        <button type="submit">Confirm Booking</button>
        <a href="/book" className="btn secondary" style={{ marginLeft: 12 }}>
          Start Over
        </a>
      </form>
    </main>
  );
}
