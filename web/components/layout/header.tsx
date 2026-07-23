import Image from 'next/image';

/** A simple application-level header for the bulletin board application. */
export const Header: React.FC = () => (
  <header data-testid="header" className="flex items-center justify-between bg-black">
    <div data-testid="header-logo" className="flex items-center px-10 py-[18px]">
      <Image src="/midnight-logo.png" alt="Midnight logo" width={304} height={66} priority />
    </div>
  </header>
);
