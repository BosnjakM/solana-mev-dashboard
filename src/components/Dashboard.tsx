import React, { useEffect, useState, useRef } from 'react';
import { XAxis, YAxis, ResponsiveContainer, BarChart, Bar, AreaChart, Area, Tooltip, CartesianGrid } from 'recharts';
import { format, addHours, startOfHour } from 'date-fns';
import { InstantVector, PrometheusDriver, QueryResult, RangeVector } from 'prometheus-query';

interface SandwichData {
  type: string;
  data: {
    publicKey: string;
    sandwich: {
      mint: string;
      slot: number;
      timestamp: number;
      frontrunInAmount: number;
      frontrunOutAmount: number;
      backrunInAmount: number;
      backrunOutAmount: number;
      solChange: number;
      tokenChange: number;
      isSell: boolean;
    };
    permanentTokenData: {
      rawTokenMetadata: {
        symbol: string;
      };
    };
  };
}

// Key for localStorage
const LOCAL_STORAGE_KEY = 'sandwichesData';

// Helper function to get initial sandwiches from localStorage
const getInitialSandwiches = (): SandwichData[] => {
  try {
    const storedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedData) {
      const parsedData = JSON.parse(storedData);
      // Basic validation to ensure it's an array
      if (Array.isArray(parsedData)) {
         // Further validation could be added here to check item structure
        return parsedData.slice(0, 50); // Ensure we only load max 50
      }
    }
  } catch (error) {
    console.error('Error reading sandwiches from localStorage:', error);
  }
  return []; // Return empty array if nothing stored or error
};

const Dashboard = () => {
  // Initialize state from localStorage
  const [sandwiches, setSandwiches] = useState<SandwichData[]>(getInitialSandwiches);
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [profitPerHour, setProfitPerHour] = useState<{ [key: string]: number }>({});
  const [activeBalanceTab, setActiveBalanceTab] = useState<'Balance' | 'Profit Rate'>('Balance');
  const [activeBundleTab, setActiveBundleTab] = useState<'Bundles' | 'Tips'>('Bundles');
  const [selectedTimeRange, setSelectedTimeRange] = useState<'1h' | '3h' | '6h' | '12h' | '24h'>('1h');
  const [balanceChartData, setBalanceChartData] = useState<any[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [bundlesPerHour, setBundlesPerHour] = useState<any[]>([]);
  const [isBundlesLoading, setIsBundlesLoading] = useState(true);
  const [profitRateData, setProfitRateData] = useState<any[]>([]);
  const [isProfitRateLoading, setIsProfitRateLoading] = useState(true);
  const [tipsPerHour, setTipsPerHour] = useState<any[]>([]);
  const [isTipsLoading, setIsTipsLoading] = useState(true);

  // Prometheus client setup
  const prom = useRef(new PrometheusDriver({
    endpoint: "https://prometheus.ny.mev-master.versatus.ch",
    baseURL: "/api/v1" // Keep default API base path
  }));

  // Update the formatChartTime function for better time formatting
  const formatChartTime = (timestamp: number) => {
    return format(new Date(timestamp), 'HH:mm:ss');
  };

  // Effect 1: Fetch HISTORICAL balance data ONCE on mount
  useEffect(() => {
    const fetchHistoricalBalance = async () => {
      setIsHistoryLoading(true);
      const endTime = new Date();
      // Ensure startTime is 24 hours ago
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
      const step = '1m'; // Fetch data point every 1 minute
      const query = 'sandwich_bank_balance_amount';

      try {
        console.log(`Fetching historical balance from ${startTime.toISOString()} to ${endTime.toISOString()} with step ${step}`);
        const result: QueryResult = await prom.current.rangeQuery(query, startTime, endTime, step);
        console.log('Historical data result:', result);

        if (result.resultType === 'matrix' && result.result.length > 0) {
          // Prometheus range query returns a matrix (multiple series potentially)
          // Assuming we only care about the first series for this metric
          const series = result.result[0] as RangeVector;
          const historicalData = series.values.map(val => ({
            time: val.time.getTime(), // Convert Date object back to timestamp (ms)
            balance: val.value
          }));
          console.log(`Fetched ${historicalData.length} historical data points.`);
          setBalanceChartData(historicalData);
        } else {
          console.error('No matrix data returned for historical balance query:', query, result);
          setBalanceChartData([]); // Start empty if history fails
        }
      } catch (error) {
        console.error('Error fetching historical balance with prometheus-query:', error);
        setBalanceChartData([]); // Start empty on error
      } finally {
         setIsHistoryLoading(false);
      }
    };

    fetchHistoricalBalance();
    // This effect runs only once on mount
  }, []); // Empty dependency array

  // Effect 2: Fetch LIVE balance data periodically and APPEND
  useEffect(() => {
    // Function to fetch the single latest balance point
    const fetchLatestBalance = async () => {
      try {
        const query = 'sandwich_bank_balance_amount';
        const result: QueryResult = await prom.current.instantQuery(query);

        if (result.resultType === 'vector' && result.result.length > 0) {
           const instantVectorResult = result.result as InstantVector[];
           if (instantVectorResult[0].value) {
             const newBalance = instantVectorResult[0].value.value;
             const newTimestamp = instantVectorResult[0].value.time.getTime(); // Use timestamp from Prometheus
             setLiveBalance(newBalance); // Update the displayed live balance number

             // Append the new data point to the existing chart data
             setBalanceChartData(prevData => {
                const newDataPoint = { time: newTimestamp, balance: newBalance };
                // Avoid adding duplicate points if timestamp hasn't changed much
                if (prevData.length > 0 && prevData[prevData.length - 1].time >= newTimestamp) {
                  return prevData;
                }
                // Keep potentially more points than needed for 3h initially, filter later
                const updatedData = [...prevData, newDataPoint];
                // Optional: Trim array if it gets excessively large over time, though filtering helps
                // return updatedData.slice(-2000); // Keep last 2000 points max
                return updatedData;
             });
           }
        } else {
          // Don't log error if instant query temporarily fails, live balance just won't update
           // console.log('No vector data returned for live balance update:', query, result);
        }
      } catch (error) {
        // Avoid logging frequent errors for live updates, maybe use a counter
        // console.error('Error fetching live balance update:', error);
      }
    };

    // Fetch immediately and then set interval
    // Wait a bit after initial load before starting live updates
    const initialDelay = 5000; // 5 seconds
    const intervalTime = 30000; // 30 seconds
    let intervalId: NodeJS.Timeout | null = null;

    const timeoutId = setTimeout(() => {
      fetchLatestBalance(); // Fetch first live point
      intervalId = setInterval(fetchLatestBalance, intervalTime);
    }, initialDelay);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
    // Rerun if prom ref changes (shouldn't happen often)
  }, [prom]);

  // Fetch profit per hour using prometheus-query
  useEffect(() => {
    const fetchProfitPerHour = async () => {
      const timeRanges = ['1h', '3h', '6h', '12h', '24h'];
      const profits: { [key: string]: number } = {};

      for (const range of timeRanges) {
        try {
          const query = `increase(sandwich_possible_profit_total[${range}])`;
          const result: QueryResult = await prom.current.instantQuery(query);
          // Check result type and access data correctly
          if (result.resultType === 'vector' && result.result.length > 0) {
            const instantVectorResult = result.result as InstantVector[];
            if (instantVectorResult[0].value) {
               profits[range] = instantVectorResult[0].value.value;
            } else {
                profits[range] = 0;
            }
          } else {
             console.error(`No vector data returned for profit per hour query (${range}):`, query, result);
             profits[range] = 0;
          }
        } catch (error) {
          console.error(`Error fetching ${range} profit with prometheus-query:`, error);
          profits[range] = 0;
        }
      }
      setProfitPerHour(profits);
    };

    fetchProfitPerHour();
    const interval = setInterval(fetchProfitPerHour, 60000);

    return () => clearInterval(interval);
  }, []);

  // Effect to save sandwiches to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sandwiches.slice(0, 50)));
    } catch (error) {
      console.error('Error saving sandwiches to localStorage:', error);
    }
  }, [sandwiches]); // Run this effect only when the sandwiches state changes

  // WebSocket connection for sandwiches - Updated primary URL
  useEffect(() => {
    console.log('Attempting to connect to WebSocket...');

    // Revert back to the IP address for the WebSocket URL
    const primaryWsUrl = 'ws://208.91.110.246:6287/ws/livefeed'; // Original IP
    const fallbackWsUrl = 'ws://136.144.59.181:6287/ws/livefeed'; // Keep old fallback

    let websocket: WebSocket | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const reconnectDelay = 3000;
    let fallbackIntervalId: NodeJS.Timeout | null = null;
    let reconnectIntervalId: NodeJS.Timeout | null = null;
    let initialFallbackIntervalId: NodeJS.Timeout | null = null; // For the initial backup fetch

    // Define the updateSandwiches function to handle state update and localStorage saving
    const updateSandwiches = (newSandwich: SandwichData) => {
       // Basic validation of structure before setting state
       if (newSandwich && newSandwich.data && newSandwich.data.sandwich) {
         setSandwiches(prev => {
           const existingIndex = prev.findIndex(s => s.data.sandwich.slot === newSandwich.data.sandwich.slot);
           if (existingIndex === -1) {
             const updatedSandwiches = [newSandwich, ...prev].slice(0, 50);
             // No need to explicitly save here, the separate useEffect handles it
             return updatedSandwiches;
           }
           return prev; // Return previous state if duplicate
         });
       } else {
         console.error('Attempted to add sandwich with unexpected structure:', newSandwich);
       }
    };

    const fetchSandwichesFallback = async () => {
      try {
        const query = 'last_sandwich_data';
        const result: QueryResult = await prom.current.instantQuery(query);
         // Check result type and access data correctly
        if (result.resultType === 'vector' && result.result.length > 0) {
          const instantVectorResult = result.result as InstantVector[];
          if (instantVectorResult[0].value) {
             try {
               // Assuming the value is a JSON string of the sandwich data
               const sandwichData = JSON.parse(instantVectorResult[0].value.value.toString());
               updateSandwiches(sandwichData); // Use the update function
             } catch (parseError) {
               console.error('Error parsing fallback sandwich data JSON:', parseError, instantVectorResult[0].value.value);
             }
          }
        } else {
          // console.log('No fallback sandwich data available from Prometheus.'); // Less noisy log
        }
      } catch (error) {
        console.error('Error fetching fallback sandwich data via Prometheus:', error);
      }
    };

    const connectWebSocket = (url: string) => {
      if (websocket) {
        websocket.close();
      }

      console.log('Connecting to WebSocket:', url);
      websocket = new WebSocket(url);

      websocket.onopen = () => {
        console.log('WebSocket connection established');
        reconnectAttempts = 0;
        // Clear fallback intervals if connection is successful
        if (fallbackIntervalId) clearInterval(fallbackIntervalId);
        if (reconnectIntervalId) clearInterval(reconnectIntervalId);
        fallbackIntervalId = null;
        reconnectIntervalId = null;
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
           // Basic validation
           if (data && data.data && data.data.sandwich) {
               updateSandwiches(data); // Use the update function
           } else {
               console.error('Received WebSocket message with unexpected structure:', data);
           }
        } catch (error) {
          console.error('Error parsing WebSocket data:', error);
        }
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        fetchSandwichesFallback(); // Fetch fallback on error
      };

      websocket.onclose = (event) => {
        console.log('WebSocket connection closed. Code:', event.code, 'Reason:', event.reason);

        // Don't attempt reconnect if explicitly closed (code 1000 or 1005)
        if (event.code === 1000 || event.code === 1005) {
          console.log('WebSocket closed normally.');
          return;
        }

        // Try to reconnect if we haven't exceeded max attempts
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const nextUrl = url === primaryWsUrl ? fallbackWsUrl : primaryWsUrl; // Alternate between primary and fallback
          console.log(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts}) to ${nextUrl}...`);
          setTimeout(() => connectWebSocket(nextUrl), reconnectDelay);

          // Fetch fallback data while trying to reconnect
          fetchSandwichesFallback();
        } else {
          console.log('Max reconnection attempts reached. Switching to fallback mode...');
           // Avoid starting multiple intervals if already in fallback mode
          if (!fallbackIntervalId) {
            fallbackIntervalId = setInterval(fetchSandwichesFallback, 10000); // Fetch every 10 seconds
          }
          if (!reconnectIntervalId) {
             // Try to reconnect to WebSocket periodically even in fallback mode
            reconnectIntervalId = setInterval(() => {
              console.log('Attempting periodic reconnect...');
              reconnectAttempts = 0; // Reset attempts for periodic check
              connectWebSocket(primaryWsUrl); // Always try primary first on periodic reconnect
            }, 30000); // Try reconnecting every 30 seconds
          }
        }
      };
    };

    // Start with primary server
    connectWebSocket(primaryWsUrl);

    // Set up initial periodic fallback data fetching as a backup
    initialFallbackIntervalId = setInterval(fetchSandwichesFallback, 30000);

    return () => {
      console.log('Cleaning up Dashboard component...');
      if (websocket) {
        websocket.onclose = () => {}; // Disable onclose handler before closing
        websocket.close();
      }
      // Clear all intervals
      if (fallbackIntervalId) clearInterval(fallbackIntervalId);
      if (reconnectIntervalId) clearInterval(reconnectIntervalId);
      if (initialFallbackIntervalId) clearInterval(initialFallbackIntervalId);
    };
  }, []);

  // Fetch Bundles per Hour (24h, 1h interval)
  useEffect(() => {
    const fetchBundlesPerHour = async () => {
      setIsBundlesLoading(true);
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
      const step = '1h';
      const query = 'increase(sandwiches_landed_total[1h])';
      try {
        const result: QueryResult = await prom.current.rangeQuery(query, startTime, endTime, step);
        if (result.resultType === 'matrix' && result.result.length > 0) {
          const series = result.result[0] as RangeVector;
          const bundlesData = series.values.map(val => ({
            hour: format(startOfHour(val.time), 'HH:mm'),
            bundles: Math.round(val.value)
          }));
          setBundlesPerHour(bundlesData);
        } else {
          setBundlesPerHour([]);
        }
      } catch (error) {
        setBundlesPerHour([]);
      } finally {
        setIsBundlesLoading(false);
      }
    };
    fetchBundlesPerHour();
  }, []);

  // Fetch Tips per Hour (24h, 1h interval)
  useEffect(() => {
    if (activeBundleTab !== 'Tips') return;
    const fetchTipsPerHour = async () => {
      setIsTipsLoading(true);
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
      const step = '1h';
      const query = 'increase(sandwich_tips_total[1h])';
      try {
        const result: QueryResult = await prom.current.rangeQuery(query, startTime, endTime, step);
        if (result.resultType === 'matrix' && result.result.length > 0) {
          const series = result.result[0] as RangeVector;
          const tipsData = series.values.map(val => ({
            hour: format(startOfHour(val.time), 'HH:mm'),
            tips: Math.round(val.value)
          }));
          setTipsPerHour(tipsData);
        } else {
          setTipsPerHour([]);
        }
      } catch (error) {
        setTipsPerHour([]);
      } finally {
        setIsTipsLoading(false);
      }
    };
    fetchTipsPerHour();
  }, [activeBundleTab]);

  // Mock data for the bundles chart
  const bundlesData = Array.from({ length: 12 }, () => ({
    hour: '',
    bundles: Math.floor(Math.random() * 45) + 15,
    tips: Math.floor(Math.random() * 30) + 10,
  }));

  const formatAmount = (amount: number | undefined, decimals: number = 9): string => {
    if (amount === undefined || amount === null || isNaN(amount)) return 'N/A';
    const divisor = Math.pow(10, decimals);
    // Determine fixed decimal places based on input decimals
    const fixedDecimals = decimals === 9 ? 3 : (decimals === 6 ? 2 : 1);
    return (amount / divisor).toFixed(fixedDecimals);
  };

  // Function to format profit data (SOL and Token)
  const formatProfit = (solChange: number | undefined, tokenChange: number | undefined, symbol: string | undefined): string => {
    if (solChange === undefined || tokenChange === undefined || symbol === undefined ||
        isNaN(solChange) || isNaN(tokenChange)) return 'N/A';
    // Assume SOL has 9 decimals, determine token decimals (e.g., 6 for USDC)
    const tokenDecimals = symbol === 'USDC' ? 6 : 9; // Default to 9 if not USDC
    const solProfit = formatAmount(solChange, 9);
    const tokenProfit = formatAmount(tokenChange, tokenDecimals);
    return `${solProfit} SOL ${tokenProfit} ${symbol}`;
  };

  // Ensure the time range filter is 24 hours
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  const filteredBalanceChartData = balanceChartData.filter(dataPoint =>
    dataPoint.time >= twentyFourHoursAgo
  );

  // Fetch Profit Rate (24h, 10m interval)
  useEffect(() => {
    if (activeBalanceTab !== 'Profit Rate') return;
    const fetchProfitRate = async () => {
      setIsProfitRateLoading(true);
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
      const step = '10m';
      const query = 'increase(sandwich_possible_profit_total[10m])';
      try {
        const result: QueryResult = await prom.current.rangeQuery(query, startTime, endTime, step);
        if (result.resultType === 'matrix' && result.result.length > 0) {
          const series = result.result[0] as RangeVector;
          const profitData = series.values.map(val => ({
            time: val.time.getTime(),
            profit: val.value
          }));
          setProfitRateData(profitData);
        } else {
          setProfitRateData([]);
        }
      } catch (error) {
        setProfitRateData([]);
      } finally {
        setIsProfitRateLoading(false);
      }
    };
    fetchProfitRate();
  }, [activeBalanceTab]);

  return (
    <div className="p-6 min-h-screen" style={{ backgroundColor: '#000' }}>
      <h1 className="text-2xl font-bold mb-6 text-white">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Balance & Profit Card (Spans 2 columns) - Darker card background */}
        <div className="md:col-span-2 card-bordered p-4 rounded-lg shadow">
          <div className="flex justify-between items-center mb-4">
            <div>
               <h2 className="text-xl font-semibold text-gray-100">Balance Over Time</h2>
               <p className="text-sm text-gray-500">Real-time balance for the Solana MEV Bot</p>
            </div>
            {/* Adjusted Button Styles */}
            <div className="flex space-x-1 bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setActiveBalanceTab('Balance')}
                className={`px-3 py-1 rounded-md text-sm ${activeBalanceTab === 'Balance' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-300'}`}
              >
                Balance
              </button>
              <button
                onClick={() => setActiveBalanceTab('Profit Rate')}
                className={`px-3 py-1 rounded-md text-sm ${activeBalanceTab === 'Profit Rate' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-300'}`}
              >
                Profit Rate
              </button>
            </div>
          </div>
          {/* Chart Area and Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
            {/* Area Chart for Balance (Spans 2 columns) */}
            <div className="lg:col-span-2 h-64">
              <ResponsiveContainer width="100%" height="100%">
                {activeBalanceTab === 'Balance' ? (
                  isHistoryLoading ? (
                    <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                      Loading historical balance data...
                    </div>
                  ) : filteredBalanceChartData.length < 2 ? (
                    <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                      Waiting for more balance data...
                    </div>
                  ) : (
                    <AreaChart data={filteredBalanceChartData}
                      margin={{ top: 10, right: 0, left: -15, bottom: 0 }}>
                      <defs>
                        <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" vertical={false} />
                      <XAxis
                        dataKey="time"
                        type="number"
                        domain={[twentyFourHoursAgo, now]}
                        allowDataOverflow={true}
                        stroke="#9ca3af"
                        tickFormatter={formatChartTime}
                        fontSize={10}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                        ticks={[
                          twentyFourHoursAgo,
                          twentyFourHoursAgo + (6 * 60 * 60 * 1000),  // +6h
                          twentyFourHoursAgo + (12 * 60 * 60 * 1000), // +12h
                          twentyFourHoursAgo + (18 * 60 * 60 * 1000), // +18h
                          now
                        ]}
                        padding={{ left: 10, right: 10 }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        fontSize={10}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#000', border: 'none', borderRadius: '4px', color: '#fff' }}
                        labelStyle={{ color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value: number) => [`$${value.toFixed(2)}`, 'Balance']}
                        labelFormatter={formatChartTime}
                      />
                      <Area type="monotone" dataKey="balance" stroke="#10b981" fillOpacity={1} fill="url(#balanceGradient)" strokeWidth={3}/>
                    </AreaChart>
                  )
                ) : (
                  isProfitRateLoading ? (
                    <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                      Loading profit rate data...
                    </div>
                  ) : profitRateData.length < 2 ? (
                    <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                      Waiting for more profit rate data...
                    </div>
                  ) : (
                    <AreaChart data={profitRateData}
                      margin={{ top: 10, right: 0, left: -15, bottom: 0 }}>
                      <defs>
                        <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e42" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#f59e42" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" vertical={false} />
                      <XAxis
                        dataKey="time"
                        type="number"
                        domain={[twentyFourHoursAgo, now]}
                        allowDataOverflow={true}
                        stroke="#9ca3af"
                        tickFormatter={formatChartTime}
                        fontSize={10}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                        ticks={[
                          twentyFourHoursAgo,
                          twentyFourHoursAgo + (6 * 60 * 60 * 1000),  // +6h
                          twentyFourHoursAgo + (12 * 60 * 60 * 1000), // +12h
                          twentyFourHoursAgo + (18 * 60 * 60 * 1000), // +18h
                          now
                        ]}
                        padding={{ left: 10, right: 10 }}
                      />
                      <YAxis
                        stroke="#9ca3af"
                        fontSize={10}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => `$${value.toFixed(2)}`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#000', border: 'none', borderRadius: '4px', color: '#fff' }}
                        labelStyle={{ color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value: number) => [`$${value.toFixed(2)}`, 'Profit']}
                        labelFormatter={formatChartTime}
                      />
                      <Area type="monotone" dataKey="profit" stroke="#f59e42" fillOpacity={1} fill="url(#profitGradient)" strokeWidth={3}/>
                    </AreaChart>
                  )
                )}
              </ResponsiveContainer>
            </div>
            {/* Live Stats Area - Darker backgrounds, green text */}
            <div className="flex flex-col justify-between space-y-4">
              {/* Live Balance */}
              <div className="card-bordered p-3">
                <h3 className="text-sm font-semibold text-white mb-1">Live Balance</h3>
                <p className="text-3xl font-bold text-green-400">${liveBalance.toFixed(2)}</p>
              </div>
              {/* Profit per Hour */}
              <div className="card-bordered p-3">
                <h3 className="text-sm font-semibold text-white mb-2">Profit per Hour</h3>
                {/* Time Range Buttons - Darker style */}
                <div className="grid grid-cols-3 gap-1 mb-2">
                  {['1h', '3h', '6h', '12h', '24h'].map((range) => (
                    <button
                      key={range}
                      onClick={() => setSelectedTimeRange(range as '1h' | '3h' | '6h' | '12h' | '24h')}
                      className={`px-2 py-0.5 text-xs rounded ${selectedTimeRange === range ? 'bg-black text-white border border-white' : 'bg-black text-gray-400 hover:bg-gray-700 hover:text-white border border-white/20'}`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
                <p className="text-2xl font-bold text-green-400">
                  ${(profitPerHour[selectedTimeRange] ?? 0).toFixed(2)}
                </p>
                <p className="text-xs text-gray-400">Over the last {selectedTimeRange}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Live Feed Card - Darker background */}
        <div className="card-bordered p-4 flex flex-col" style={{ maxHeight: '500px' }}>
          <div className="flex justify-between items-center mb-4 flex-shrink-0">
            <h2 className="text-xl font-semibold text-gray-100">Live Feed</h2>
            {/* Adjusted select style */}
            <select className="bg-black text-white rounded px-2 py-1 text-sm border border-white/20 focus:outline-none focus:border-green-500">
              <option>Sandwiches</option>
            </select>
          </div>
          {/* Scrollable Feed Area - Darker items */}
          <div className="flex-grow overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-800">
            {sandwiches.length === 0 && (
               <div className="text-center text-gray-500 py-10">Waiting for sandwich data...</div>
            )}
            {sandwiches.map((s, index) => (
              <div key={`${s.data.sandwich.slot}-${index}`} className="card-bordered p-3">
                <div className="flex justify-between items-center text-xs mb-1 text-gray-400">
                  <span>🥪 Sandwich</span>
                  <span>{format(new Date(s.data.sandwich.timestamp * 1000), 'HH:mm:ss')}</span>
                </div>
                <div className="text-sm space-y-0.5 text-gray-300">
                   {/* Frontrun - Green arrow */}
                   <p className="flex items-center">
                       <span className="text-green-500 w-4">↑</span>
                       {s.data.sandwich.isSell ?
                           <span>{formatAmount(s.data.sandwich.frontrunInAmount, s.data.permanentTokenData?.rawTokenMetadata?.symbol === 'USDC' ? 6 : 9)} {s.data.permanentTokenData?.rawTokenMetadata?.symbol || 'TOK'} → {formatAmount(s.data.sandwich.frontrunOutAmount, 9)} SOL</span>
                           :
                           <span>{formatAmount(s.data.sandwich.frontrunInAmount, 9)} SOL → {formatAmount(s.data.sandwich.frontrunOutAmount, s.data.permanentTokenData?.rawTokenMetadata?.symbol === 'USDC' ? 6 : 9)} {s.data.permanentTokenData?.rawTokenMetadata?.symbol || 'TOK'}</span>
                       }
                       {/* Link placeholder - Adjusted style */}
                       <a href="#" className="ml-1 text-gray-500 hover:text-green-500 text-xs opacity-75">🔗</a>
                   </p>
                   {/* User Tx - Gray */}
                   <p className="text-gray-400 text-xs pl-4">
                       <span className="opacity-75">👤 User Transaction</span>
                       <a href="#" className="ml-1 text-gray-500 hover:text-green-500 text-xs opacity-75">🔗</a>
                   </p>
                   {/* Backrun - Red arrow */}
                   <p className="flex items-center">
                       <span className="text-red-500 w-4">↓</span>
                        {s.data.sandwich.isSell ?
                           <span>{formatAmount(s.data.sandwich.backrunInAmount, 9)} SOL → {formatAmount(s.data.sandwich.backrunOutAmount, s.data.permanentTokenData?.rawTokenMetadata?.symbol === 'USDC' ? 6 : 9)} {s.data.permanentTokenData?.rawTokenMetadata?.symbol || 'TOK'}</span>
                           :
                           <span>{formatAmount(s.data.sandwich.backrunInAmount, s.data.permanentTokenData?.rawTokenMetadata?.symbol === 'USDC' ? 6 : 9)} {s.data.permanentTokenData?.rawTokenMetadata?.symbol || 'TOK'} → {formatAmount(s.data.sandwich.backrunOutAmount, 9)} SOL</span>
                       }
                       <a href="#" className="ml-1 text-gray-500 hover:text-green-500 text-xs opacity-75">🔗</a>
                   </p>
                </div>
                {/* Profit Line - Green text */}
                <p className="text-xs mt-2">
                  <span className="font-semibold text-gray-400">Profit:</span>
                  <span className="font-semibold text-green-500 ml-1">{formatProfit(s.data.sandwich.solChange, s.data.sandwich.tokenChange, s.data.permanentTokenData?.rawTokenMetadata?.symbol)}</span>
                  <span className="text-gray-500 ml-2 float-right">{s.data.sandwich.slot}</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Bundles per Hour Card (Spans 3 columns) - Darker background, adjusted button/chart styles */}
        <div className="md:col-span-3 card-bordered p-4 mt-8">
          <div className="flex justify-between items-center mb-2">
            <div>
              <h2 className="text-xl font-semibold text-gray-100">Bundles per Hour</h2>
              <p className="text-sm text-gray-500">Number of bundles processed each hour</p>
            </div>
            <div className="flex space-x-1 bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setActiveBundleTab('Bundles')}
                className={`px-3 py-1 rounded-md text-sm ${activeBundleTab === 'Bundles' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-300'}`}
              >
                Bundles
              </button>
              <button
                onClick={() => setActiveBundleTab('Tips')}
                className={`px-3 py-1 rounded-md text-sm ${activeBundleTab === 'Tips' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-300'}`}
              >
                Tips
              </button>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              {activeBundleTab === 'Bundles' ? (
                isBundlesLoading ? (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading bundles data...</div>
                ) : bundlesPerHour.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-red-500 text-sm">No bundles data found for the last 24h.</div>
                ) : (
                  <BarChart data={bundlesPerHour} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" vertical={false} />
                    <XAxis dataKey="hour" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#000', border: 'none', borderRadius: '4px', color: '#fff' }}
                      labelStyle={{ color: '#fff' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(value: number) => [Math.round(value), 'bundles']}
                    />
                    <Bar dataKey="bundles" fill="#fff" radius={[4, 4, 0, 0]} activeBar={{ fill: 'rgba(255,255,255,0.25)', stroke: 'none' }} />
                  </BarChart>
                )
              ) : (
                isTipsLoading ? (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading tips data...</div>
                ) : tipsPerHour.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-red-500 text-sm">No tips data found for the last 24h.</div>
                ) : (
                  <BarChart data={tipsPerHour} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" vertical={false} />
                    <XAxis dataKey="hour" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#000', border: 'none', borderRadius: '4px', color: '#fff' }}
                      labelStyle={{ color: '#fff' }}
                      itemStyle={{ color: '#fff' }}
                      formatter={(value: number) => [Math.round(value), 'tips']}
                    />
                    <Bar dataKey="tips" fill="#f59e42" radius={[4, 4, 0, 0]} activeBar={{ fill: 'rgba(245,158,66,0.25)', stroke: 'none' }} />
                  </BarChart>
                )
              )}
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Dashboard; 