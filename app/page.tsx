import BookingForm from "@/components/booking-form";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-1 px-5 py-5 sm:px-8">
          <p className="text-[18px] font-semibold leading-6 tracking-[-0.01em] text-ink">
            Jasper Plumbing House
          </p>
          <p className="text-[13px] leading-5 text-muted">
            Materials · Installations · Repairs
          </p>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[960px] px-5 pb-16 pt-12 sm:px-8">
          <div className="max-w-[560px]">
            <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[36px]">
              Get a price before you book.
            </h1>
            <p className="mt-3 text-[16px] leading-[26px] text-muted">
              Tell us what needs fixing and your distance from us. You&apos;ll
              see an estimate before you request a time.
            </p>
          </div>

          <div className="mt-8">
            <BookingForm />
          </div>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-1 px-5 py-6 text-[13px] leading-5 text-muted sm:px-8">
          <p>Jasper Plumbing House · Materials · Installations · Repairs</p>
          <p>Prices are estimates until your booking is confirmed.</p>
        </div>
      </footer>
    </div>
  );
}