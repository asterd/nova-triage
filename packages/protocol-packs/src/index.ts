export interface ProtocolVariant {
    id: string;
    name: string;
    labels: Record<string, string>;
    colors: Record<string, string>;
}

export const GenericProtocol: ProtocolVariant = {
    id: 'generic',
    name: 'Generic Global Protocol',
    labels: {
        critical: 'Immediate Resuscitation',
        high: 'Very Urgent',
        moderate: 'Urgent',
        low: 'Standard Care',
        minimal: 'Non-Urgent'
    },
    colors: {
        critical: '#D92D20',
        high: '#F79009',
        moderate: '#FDB022',
        low: '#12B76A',
        minimal: '#0F6CBD'
    }
};

export const ItalyProtocol: ProtocolVariant = {
    id: 'italy',
    name: 'Italian National Triage',
    labels: {
        critical: 'Codice Rosso',
        high: 'Codice Arancione',
        moderate: 'Codice Azzurro',
        low: 'Codice Verde',
        minimal: 'Codice Bianco'
    },
    colors: {
        critical: '#D92D20', // Red
        high: '#F79009', // Orange
        moderate: '#00BFFF', // Light Blue
        low: '#12B76A', // Green
        minimal: '#FFFFFF' // White
    }
};

export const HomeCareProtocol: ProtocolVariant = {
    id: 'home',
    name: 'Home Care Protocol',
    labels: {
        critical: 'Call Emergency Services',
        high: 'Same-day Urgent Care',
        moderate: 'Schedule Doctor Visit',
        low: 'Monitor and Contact',
        minimal: 'Self-care at Home'
    },
    colors: {
        critical: '#D92D20',
        high: '#F79009',
        moderate: '#FDB022',
        low: '#12B76A',
        minimal: '#0F6CBD'
    }
};

export const ProtocolPacks: Record<string, ProtocolVariant> = {
    generic: GenericProtocol,
    italy: ItalyProtocol,
    home: HomeCareProtocol
};
