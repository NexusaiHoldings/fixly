export default function BookPage() {
  return (
    <main>
      <h1>Book a Tradesperson</h1>
      <p>
        Tell us what you need and upload photos — our AI will generate an
        instant, non-binding price estimate so you can confirm your booking
        right away.
      </p>

      {/* GET form: category + description become query params on /book/photos */}
      <form method="get" action="/book/photos">
        <label htmlFor="category">Service Category</label>
        <select id="category" name="category" required defaultValue="">
          <option value="" disabled>
            Select a category…
          </option>
          <option value="plumbing">Plumbing</option>
          <option value="electrical">Electrical</option>
        </select>

        <label htmlFor="description">Describe the Issue</label>
        <textarea
          id="description"
          name="description"
          rows={5}
          required
          placeholder="e.g. Kitchen tap dripping constantly, slow drain in bathroom, light switch sparking…"
        />

        <button type="submit">Continue — Add Photos</button>
      </form>
    </main>
  );
}
