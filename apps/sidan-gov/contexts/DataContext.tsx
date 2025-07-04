import React, { createContext, useContext, useEffect, useState } from 'react';
import fetchData from '../lib/fetchData';
import { OrgData, CatalystContextData, DRepVotingData, YearlyStats, DiscordStats, ContributorStats, DataContextType, ContributorsData, StakePoolContextData, PoolHistoryData, PoolVotesData } from '../types';
import { aggregateContributorStats } from '../utils/contributorStats';
import config from '../config';

const DataContext = createContext<DataContextType | undefined>(undefined);

// Cache is enabled by default unless explicitly disabled via NEXT_PUBLIC_ENABLE_DEV_CACHE=false
const CACHE_DURATION = process.env.NEXT_PUBLIC_ENABLE_DEV_CACHE === 'false'
    ? 0
    : 5 * 60 * 1000;
const ORG_STORAGE_KEY = 'sidanGovData';
const CATALYST_STORAGE_KEY = 'catalystData';
const DREP_VOTING_STORAGE_KEY = 'drepVotingData';
const DISCORD_STATS_STORAGE_KEY = 'discordStats';
const CONTRIBUTOR_STATS_STORAGE_KEY = 'contributorStats';
const CONTRIBUTORS_DATA_STORAGE_KEY = 'contributorsData';
const STAKE_POOL_STORAGE_KEY = 'stakePoolData';

// Get configuration values
const ORGANIZATION_NAME = config.organization.name;
const GOVERNANCE_REPO = config.repositories.governance;
const BASE_URL = `https://raw.githubusercontent.com/${ORGANIZATION_NAME}/${GOVERNANCE_REPO}/main/${config.outputPaths.baseDir}`;

// GitHub API base URL
const GITHUB_API_BASE = `https://api.github.com/repos/${ORGANIZATION_NAME}/${GOVERNANCE_REPO}/contents/${config.outputPaths.baseDir}`;

// Utility function to check if localStorage is available
const isLocalStorageAvailable = (): boolean => {
    try {
        const testKey = '__test__';
        localStorage.setItem(testKey, testKey);
        localStorage.removeItem(testKey);
        return true;
    } catch (e) {
        console.warn('localStorage is not available:', e);
        return false;
    }
};

// Safe localStorage getItem with fallback
const safeGetItem = (key: string): string | null => {
    if (!isLocalStorageAvailable()) return null;
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.error(`Error reading ${key} from localStorage:`, e);
        return null;
    }
};

// Safe localStorage setItem
const safeSetItem = (key: string, value: string): void => {
    if (!isLocalStorageAvailable()) return;
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.error(`Error writing ${key} to localStorage:`, e);
    }
};

export function DataProvider({ children }: { children: React.ReactNode }) {
    const [orgData, setOrgData] = useState<OrgData | null>(null);
    const [catalystData, setCatalystData] = useState<CatalystContextData | null>(null);
    const [drepVotingData, setDrepVotingData] = useState<DRepVotingData | null>(null);
    const [discordStats, setDiscordStats] = useState<DiscordStats | null>(null);
    const [contributorStats, setContributorStats] = useState<Record<number, ContributorStats> | null>(null);
    const [contributorsData, setContributorsData] = useState<ContributorsData | null>(null);
    const [stakePoolData, setStakePoolData] = useState<StakePoolContextData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const getCurrentYear = () => new Date().getFullYear();

    const fetchYearlyStats = async (year: number) => {
        try {
            return await fetchData(`${BASE_URL}/${config.outputPaths.statsDir}/sidan-yearly-stats-${year}.json`);
        } catch (error) {
            console.warn(`Failed to fetch stats for year ${year}:`, error);
            return null;
        }
    };

    const fetchYearlyVotes = async (year: number) => {
        try {
            return await fetchData(`${BASE_URL}/${config.outputPaths.drepVotingDir}/${year}_voting.json`);
        } catch (error) {
            console.warn(`Failed to fetch votes for year ${year}:`, error);
            return null;
        }
    };

    const fetchOrgData = async () => {
        try {
            // console.log('Fetching sidan data...');
            const currentYear = getCurrentYear();
            const startYear = 2024;
            const years = Array.from({ length: currentYear - startYear + 1 }, (_, i) => startYear + i);

            // Fetch current stats
            let currentStats;
            try {
                // console.log('Fetching current stats...');
                currentStats = await fetchData(`${BASE_URL}/${config.outputPaths.statsDir}/sidan_stats.json`);
                // console.log('Current stats fetched:', currentStats);
            } catch (error) {
                console.error('Error fetching current stats:', error);
                currentStats = null;
            }

            // Fetch yearly stats
            // console.log('Fetching yearly stats for years:', years);
            const yearlyStatsPromises = years.map(year => fetchYearlyStats(year));
            const yearlyStatsResults = await Promise.all(yearlyStatsPromises);

            // console.log('Yearly stats results:', yearlyStatsResults);

            // Create yearlyStats object, filtering out null results
            const yearlyStats = years.reduce((acc, year, index) => {
                if (yearlyStatsResults[index] !== null) {
                    acc[year] = yearlyStatsResults[index];
                }
                return acc;
            }, {} as Record<number, YearlyStats>);

            // console.log('Processed yearly stats:', yearlyStats);

            // Only save data if we have at least current stats or some yearly stats
            if (!currentStats && Object.keys(yearlyStats).length === 0) {
                throw new Error('No sidan data available');
            }

            const newData: OrgData = {
                currentStats,
                yearlyStats,
                lastFetched: Date.now()
            };

            // console.log('Setting new sidan data:', newData);
            safeSetItem(ORG_STORAGE_KEY, JSON.stringify(newData));
            setOrgData(newData);
            setError(null);
        } catch (err) {
            console.error('Error fetching sidan data:', err);
            setError('Failed to fetch sidan data');
            setOrgData(null);
        }
    };

    const fetchDRepVotingData = async () => {
        try {
            // console.log('Fetching DRep voting data...');
            const currentYear = getCurrentYear();
            const startYear = 2024;
            const years = Array.from({ length: currentYear - startYear + 1 }, (_, i) => startYear + i);

            // Fetch yearly votes
            const yearlyVotesResults = await Promise.all(years.map(year => fetchYearlyVotes(year)));

            // Combine all votes and sort by blockTime, filtering out null results
            const allVotes = yearlyVotesResults
                .filter(votes => votes !== null)
                .flat()
                .sort((a, b) => new Date(b.blockTime).getTime() - new Date(a.blockTime).getTime());

            // Fetch delegation data
            // console.log('Fetching delegation data...');
            const delegationData = await fetchData(`${BASE_URL}/${config.outputPaths.drepVotingDir}/drep-delegation-info.json`);
            // console.log('Received delegation data:', delegationData);

            // Fetch metadata if meta_url is available
            let metadata = null;
            if (delegationData?.drepInfo?.meta_url) {
                try {
                    // console.log('Fetching metadata from:', delegationData.drepInfo.meta_url);
                    const metadataResponse = await fetch(delegationData.drepInfo.meta_url);
                    if (metadataResponse.ok) {
                        const metadataData = await metadataResponse.json();
                        // Extract the relevant fields from the metadata
                        metadata = {
                            objectives: metadataData.body?.objectives || '',
                            motivations: metadataData.body?.motivations || '',
                            qualifications: metadataData.body?.qualifications || '',
                            givenName: metadataData.body?.givenName || '',
                            paymentAddress: metadataData.body?.paymentAddress || '',
                            doNotList: metadataData.body?.doNotList || false,
                            references: metadataData.body?.references || []
                        };
                        // console.log('Fetched metadata:', metadata);
                    }
                } catch (metadataError) {
                    console.warn('Failed to fetch metadata:', metadataError);
                }
            }

            const newData: DRepVotingData = {
                votes: allVotes,
                delegationData: delegationData ? {
                    ...delegationData,
                    metadata
                } : null,
                lastFetched: Date.now()
            };

            // console.log('Setting DRep voting data:', newData);
            safeSetItem(DREP_VOTING_STORAGE_KEY, JSON.stringify(newData));
            setDrepVotingData(newData);
        } catch (err) {
            console.error('Error fetching DRep voting data:', err);
            setDrepVotingData(null);
        }
    };

    const fetchCatalystData = async () => {
        try {
            const data = await fetchData(`${BASE_URL}/${config.outputPaths.catalystProposalsDir}/catalyst-data.json`);
            const newData: CatalystContextData = {
                catalystData: data,
                lastFetched: Date.now()
            };
            safeSetItem(CATALYST_STORAGE_KEY, JSON.stringify(newData));
            setCatalystData(newData);
        } catch (err) {
            console.error('Error fetching catalyst data:', err);
            setCatalystData(null);
        }
    };

    const fetchDiscordStats = async () => {
        try {
            const data = await fetchData(`${BASE_URL}/${config.outputPaths.discordStatsDir}/stats.json`);
            const newData = {
                stats: data,
                lastFetched: Date.now()
            };
            safeSetItem(DISCORD_STATS_STORAGE_KEY, JSON.stringify(newData));
            setDiscordStats(newData);
        } catch (err) {
            console.error('Error fetching Discord stats:', err);
            setDiscordStats(null);
        }
    };

    const fetchContributorStats = async () => {
        try {
            const currentYear = getCurrentYear();
            const startYear = 2022;
            const years = Array.from({ length: currentYear - startYear + 1 }, (_, i) => startYear + i);

            // Fetch yearly contributor stats
            const yearlyStatsPromises = years.map(year =>
                fetchData(`${BASE_URL}/${config.outputPaths.statsDir}/${config.outputPaths.contributionsDir}/contributors-${year}.json`)
                    .catch(error => {
                        console.warn(`Failed to fetch contributor stats for year ${year}:`, error);
                        return null;
                    })
            );

            const yearlyStatsResults = await Promise.all(yearlyStatsPromises);

            // Create yearlyStats object, filtering out null results
            const yearlyStats = years.reduce((acc, year, index) => {
                if (yearlyStatsResults[index] !== null) {
                    acc[year] = yearlyStatsResults[index];
                }
                return acc;
            }, {} as Record<number, ContributorStats>);

            // Aggregate contributor stats
            const aggregatedContributors = aggregateContributorStats(yearlyStats);

            // Calculate totals
            const totals = aggregatedContributors.reduce((acc, contributor) => ({
                total_commits: acc.total_commits + contributor.commits,
                total_pull_requests: acc.total_pull_requests + contributor.pull_requests,
                total_contributions: acc.total_contributions + contributor.contributions
            }), {
                total_commits: 0,
                total_pull_requests: 0,
                total_contributions: 0
            });

            const newData = {
                stats: yearlyStats,
                lastFetched: Date.now()
            };

            safeSetItem(CONTRIBUTOR_STATS_STORAGE_KEY, JSON.stringify(newData));
            setContributorStats(yearlyStats);

            // Create and store contributors data separately
            const newContributorsData: ContributorsData = {
                unique_count: aggregatedContributors.length,
                contributors: aggregatedContributors,
                ...totals,
                lastFetched: Date.now()
            };

            safeSetItem(CONTRIBUTORS_DATA_STORAGE_KEY, JSON.stringify(newContributorsData));
            setContributorsData(newContributorsData);
        } catch (err) {
            console.error('Error fetching contributor stats:', err);
            setContributorStats(null);
            setContributorsData(null);
        }
    };

    const getAvailableStakePoolFiles = async (): Promise<{ poolHistoryFiles: string[], poolVotesFiles: string[] }> => {
        try {
            const stakePoolDirPath = `${config.outputPaths.stakePoolDir}`;
            const response = await fetch(`${GITHUB_API_BASE}/${stakePoolDirPath}`);

            if (!response.ok) {
                console.warn('Failed to fetch stake pool directory contents:', response.status);
                return { poolHistoryFiles: [], poolVotesFiles: [] };
            }

            const contents = await response.json();

            if (!Array.isArray(contents)) {
                console.warn('Unexpected response format from GitHub API');
                return { poolHistoryFiles: [], poolVotesFiles: [] };
            }

            const poolHistoryFiles: string[] = [];
            const poolVotesFiles: string[] = [];

            contents.forEach((item: { type: string; name: string }) => {
                if (item.type === 'file' && item.name) {
                    if (item.name.startsWith('pool-history-') && item.name.endsWith('.json')) {
                        poolHistoryFiles.push(item.name);
                    } else if (item.name.startsWith('pool-votes-') && item.name.endsWith('.json')) {
                        poolVotesFiles.push(item.name);
                    }
                }
            });

            return { poolHistoryFiles, poolVotesFiles };
        } catch (error) {
            console.warn('Error fetching stake pool directory contents:', error);
            return { poolHistoryFiles: [], poolVotesFiles: [] };
        }
    };

    const fetchStakePoolData = async () => {
        try {
            // First, get the list of available files from GitHub
            const { poolHistoryFiles, poolVotesFiles } = await getAvailableStakePoolFiles();

            // Fetch pool info
            let poolInfo = null;
            try {
                poolInfo = await fetchData(`${BASE_URL}/${config.outputPaths.stakePoolDir}/stake-pool-info.json`);
            } catch (error) {
                console.warn('Failed to fetch stake pool info:', error);
            }

            // Fetch pool history files that actually exist
            const poolHistoryPromises = poolHistoryFiles.map(filename =>
                fetchData(`${BASE_URL}/${config.outputPaths.stakePoolDir}/${filename}`)
                    .catch(error => {
                        console.warn(`Failed to fetch pool history file ${filename}:`, error);
                        return null;
                    })
            );

            const poolHistoryResults = await Promise.all(poolHistoryPromises);

            // Create poolHistory object, filtering out null results and extracting year from filename
            const poolHistory = poolHistoryResults.reduce((acc, data, index) => {
                if (data !== null) {
                    const filename = poolHistoryFiles[index];
                    const yearMatch = filename.match(/pool-history-(\d{4})\.json/);
                    if (yearMatch) {
                        const year = parseInt(yearMatch[1], 10);
                        acc[year] = data;
                    }
                }
                return acc;
            }, {} as Record<number, PoolHistoryData>);

            // Fetch pool votes files that actually exist
            const poolVotesPromises = poolVotesFiles.map(filename =>
                fetchData(`${BASE_URL}/${config.outputPaths.stakePoolDir}/${filename}`)
                    .catch(error => {
                        console.warn(`Failed to fetch pool votes file ${filename}:`, error);
                        return null;
                    })
            );

            const poolVotesResults = await Promise.all(poolVotesPromises);

            // Create poolVotes object, filtering out null results and extracting year from filename
            const poolVotes = poolVotesResults.reduce((acc, data, index) => {
                if (data !== null) {
                    const filename = poolVotesFiles[index];
                    const yearMatch = filename.match(/pool-votes-(\d{4})\.json/);
                    if (yearMatch) {
                        const year = parseInt(yearMatch[1], 10);
                        acc[year] = data;
                    }
                }
                return acc;
            }, {} as Record<number, PoolVotesData>);

            const newData: StakePoolContextData = {
                poolInfo,
                poolHistory,
                poolVotes,
                lastFetched: Date.now()
            };

            safeSetItem(STAKE_POOL_STORAGE_KEY, JSON.stringify(newData));
            setStakePoolData(newData);
        } catch (err) {
            console.error('Error fetching stake pool data:', err);
            setStakePoolData(null);
        }
    };

    const loadData = async () => {
        setIsLoading(true);
        setError(null);

        try {
            if (process.env.NEXT_PUBLIC_ENABLE_DEV_CACHE === 'false' || !isLocalStorageAvailable()) {
                // First fetch sidan data
                await fetchOrgData();
                // Then fetch other data
                await Promise.all([
                    fetchCatalystData(),
                    fetchDRepVotingData(),
                    fetchDiscordStats(),
                    fetchContributorStats(),
                    fetchStakePoolData()
                ]);
                setIsLoading(false);
                return;
            }

            const cachedOrgData = safeGetItem(ORG_STORAGE_KEY);
            const cachedCatalystData = safeGetItem(CATALYST_STORAGE_KEY);
            const cachedDRepVotingData = safeGetItem(DREP_VOTING_STORAGE_KEY);
            const cachedDiscordStats = safeGetItem(DISCORD_STATS_STORAGE_KEY);
            const cachedContributorStats = safeGetItem(CONTRIBUTOR_STATS_STORAGE_KEY);
            const cachedContributorsData = safeGetItem(CONTRIBUTORS_DATA_STORAGE_KEY);
            const cachedStakePoolData = safeGetItem(STAKE_POOL_STORAGE_KEY);

            // First handle sidan data
            if (cachedOrgData) {
                const parsed = JSON.parse(cachedOrgData);
                const cacheAge = Date.now() - parsed.lastFetched;
                if (cacheAge < CACHE_DURATION) {
                    setOrgData(parsed);
                }
            }

            // Then handle other cached data
            if (cachedCatalystData) {
                const parsed = JSON.parse(cachedCatalystData);
                const cacheAge = Date.now() - parsed.lastFetched;
                if (cacheAge < CACHE_DURATION) {
                    setCatalystData(parsed);
                }
            }

            if (cachedDRepVotingData) {
                const parsed = JSON.parse(cachedDRepVotingData);
                const cacheAge = Date.now() - parsed.lastFetched;
                if (cacheAge < CACHE_DURATION) {
                    setDrepVotingData(parsed);
                }
            }

            if (cachedDiscordStats) {
                const parsed = JSON.parse(cachedDiscordStats);
                const cacheAge = Date.now() - parsed.lastFetched;
                if (cacheAge < CACHE_DURATION) {
                    setDiscordStats(parsed);
                }
            }

            if (cachedContributorStats) {
                const parsed = JSON.parse(cachedContributorStats);
                const cacheAge = Date.now() - parsed.lastFetched;
                if (cacheAge < CACHE_DURATION) {
                    setContributorStats(parsed.stats);
                }
            }

            if (cachedContributorsData) {
                const parsed = JSON.parse(cachedContributorsData);
                const cacheAge = Date.now() - parsed.lastFetched;
                if (cacheAge < CACHE_DURATION) {
                    setContributorsData(parsed);
                }
            }

            if (cachedStakePoolData) {
                const parsed = JSON.parse(cachedStakePoolData);
                const cacheAge = Date.now() - parsed.lastFetched;
                if (cacheAge < CACHE_DURATION) {
                    setStakePoolData(parsed);
                }
            }

            // Fetch fresh data if cache is expired or missing
            const fetchPromises = [];

            // Always fetch sidan data first
            if (!cachedOrgData || Date.now() - JSON.parse(cachedOrgData).lastFetched >= CACHE_DURATION) {
                await fetchOrgData();
            }

            // Then fetch other data
            if (!cachedCatalystData || Date.now() - JSON.parse(cachedCatalystData).lastFetched >= CACHE_DURATION) {
                fetchPromises.push(fetchCatalystData());
            }
            if (!cachedDRepVotingData || Date.now() - JSON.parse(cachedDRepVotingData).lastFetched >= CACHE_DURATION) {
                fetchPromises.push(fetchDRepVotingData());
            }
            if (!cachedDiscordStats || Date.now() - JSON.parse(cachedDiscordStats).lastFetched >= CACHE_DURATION) {
                fetchPromises.push(fetchDiscordStats());
            }
            if (!cachedContributorStats || Date.now() - JSON.parse(cachedContributorStats).lastFetched >= CACHE_DURATION) {
                fetchPromises.push(fetchContributorStats());
            }
            if (!cachedStakePoolData || Date.now() - JSON.parse(cachedStakePoolData).lastFetched >= CACHE_DURATION) {
                fetchPromises.push(fetchStakePoolData());
            }

            await Promise.all(fetchPromises);
        } catch (err) {
            console.error('Error loading data:', err);
            setError('Failed to load data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const refetchData = async () => {
        setIsLoading(true);
        await Promise.all([
            fetchOrgData(),
            fetchCatalystData(),
            fetchDRepVotingData(),
            fetchDiscordStats(),
            fetchContributorStats(),
            fetchStakePoolData()
        ]);
        setIsLoading(false);
    };

    return (
        <DataContext.Provider value={{ orgData, catalystData, drepVotingData, discordStats, contributorStats, contributorsData, stakePoolData, isLoading, error, refetchData }}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    const context = useContext(DataContext);
    if (context === undefined) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
} 