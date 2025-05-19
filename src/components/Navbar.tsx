import React from 'react';
import { Link } from 'react-router-dom';

const Navbar = () => {
  return (
    <nav className="bg-[#1a1a1a] px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <h1 className="text-xl font-semibold">Solana MEV Bot</h1>
          <div className="flex space-x-4">
            <Link to="/" className="text-white hover:text-gray-300">Dashboard</Link>
            <Link to="/tokens" className="text-gray-400 hover:text-gray-300">Tokens</Link>
            <Link to="/global" className="text-gray-400 hover:text-gray-300">Global</Link>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
