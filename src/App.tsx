import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import Navbar from './components/Navbar';

function App() {
    return (
        <Router>
            <div className="min-h-screen bg-[#121212] text-white">
                <Navbar />
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                </Routes>
            </div>
        </Router>
    );
}

export default App;
