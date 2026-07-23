import Image from 'next/image';
import { Header } from './header';

/** Provides the shared page chrome (header + backdrop) for the bulletin board application. */
export const MainLayout: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div className="min-h-screen overflow-hidden">
    <Header />
    <div className="relative h-full px-[6vw] sm:px-10">
      <Image
        src="/logo-render.png"
        alt=""
        width={607}
        height={607}
        priority
        className="pointer-events-none absolute left-[2vw] top-[5vh] z-[1] opacity-40 sm:opacity-100"
      />
      <div className="relative z-[999] flex h-full flex-wrap items-center justify-center gap-[5px] px-[4vw] py-[10vh] sm:px-[15vw]">
        {children}
      </div>
    </div>
  </div>
);
