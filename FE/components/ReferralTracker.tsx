"use client";

import { useEffect } from "react";
import { getStoredRef } from "@/lib/referralClient";

export function ReferralTracker() {
    useEffect(() => {
        getStoredRef();
    }, []);

    return null;
}
