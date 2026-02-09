
import React, { createContext, useContext, useState, useEffect } from 'react';
import { dbService } from '../services/dbService';
import { MidwayState } from '../types';

interface BroadcastContextType {
    broadcast: MidwayState | null;
    syncStatus: string;
}

const BroadcastContext = createContext<BroadcastContextType | undefined>(undefined);

export const BroadcastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [broadcast, setBroadcast] = useState<MidwayState | null>(null);
    const [syncStatus, setSyncStatus] = useState<string>('IDLE');

    useEffect(() => {
        // Initial fetch
        dbService.getMidwayState().then(state => {
            if (state) setBroadcast(state);
        });

        // Subscribe to changes
        const subscription = dbService.subscribeToMidway(
            (newState) => {
                setBroadcast(newState);
            },
            (status) => {
                setSyncStatus(status);
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    return (
        <BroadcastContext.Provider value={{ broadcast, syncStatus }}>
            {children}
        </BroadcastContext.Provider>
    );
};

export const useBroadcast = () => {
    const context = useContext(BroadcastContext);
    if (context === undefined) {
        throw new Error('useBroadcast must be used within a BroadcastProvider');
    }
    return context;
};
