"use client";

import React, { useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Header } from "@/components/dashboard/Header";
import { cn } from "@/lib/utils";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#060a12] flex flex-col">
      <Header isCollapsed={isCollapsed} />
      <div className="flex flex-1 pt-16">
        <Sidebar isCollapsed={isCollapsed} onToggle={() => setIsCollapsed(!isCollapsed)} />
        <main
          className={cn(
            "flex-1 transition-all duration-300 min-w-0",
            isCollapsed ? "lg:pl-[80px]" : "lg:pl-72"
          )}
        >
          <div className="p-4 sm:p-6 md:p-8 max-w-[1600px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
