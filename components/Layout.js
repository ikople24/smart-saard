import { useRouter } from "next/router";
import BottomNav from "./BottomNav";
import TopNavbar from "./TopNavbar";

const Layout = ({ children }) => {
  const router = useRouter();
  const isTaxMap = router.pathname === "/admin/tax-map";

  if (isTaxMap) {
    return (
      <div className="h-screen w-full flex flex-col bg-gray-50 overflow-hidden">
        <main className="flex-1 w-full h-full overflow-hidden flex flex-col">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-100 w-full min-w-[320px]">
      <TopNavbar/>
      <main className="flex-1 pb-16 px-4 pt-4 flex flex-col gap-4 w-full overflow-x-hidden">
        <div className="w-full">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
};

export default Layout;