import React, { useState, useEffect } from 'react';
import { Container, Table, Form, Button, Modal, Pagination, Dropdown, Col } from 'react-bootstrap';
import { FaPlus } from "react-icons/fa";
import './InputAward.css';

const AwardsManager = () => {
    const [awards, setAwards] = useState([]);
    const [newAward, setNewAward] = useState({ country_name: '', awards_years: '', awards_name: '' });
    const [editing, setEditing] = useState(null);
    const [editAward, setEditAward] = useState({ country_name: '', awards_years: '', awards_name: '' });
    const [showModal, setShowModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [loading, setLoading] = useState(true); // To handle loading state
    const [currentPage, setCurrentPage] = useState(1); // State for current page
    const [searchTerm, setSearchTerm] = useState(""); // State untuk menyimpan input pencarian
    const [showCount, setShowCount] = useState(10); // Items per page

    useEffect(() => {
        const fetchAwards = async () => {
            try {
                const response = await fetch('http://localhost:8001/awards');
                const data = await response.json();
                setAwards(data);
                setLoading(false);
            } catch (error) {
                console.error("Error fetching actors:", error);
                setLoading(false);
            }
        };
        fetchAwards();
    }, []);

    const handleShowModal = () => {
        setIsEditing(false);
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        if (isEditing) {
            // Reset the editing state and clear editActor data
            setEditAward({ country_name: '', awards_years: '', awards_name: '' });
        } else {
            // Reset the newActor state
            setNewAward({ country_name: '', awards_years: '', awards_name: '' });
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (isEditing) {
            setEditAward((prev) => ({ ...prev, [name]: value }));
        } else {
            setNewAward((prev) => ({ ...prev, [name]: value }));
        }
    };

    const checkCountryExists = async (countryName) => {
        try {
            const response = await fetch(`http://localhost:8001/countries?name=${countryName}`);
            const data = await response.json();
            console.log(data);
            // Memeriksa apakah data ada dan mengembalikan ID negara
            if (data.length > 0) {
                console.log("Country found:", data[0]);
                return data[0].id; // Mengembalikan ID negara
            } else {
                console.log("Country not found");
                return false; // Jika negara tidak ditemukan
            }
        } catch (error) {
            console.error("Error checking country existence:", error);
            return false;
        }
    };

    const handleAddAward = async (e) => {
        e.preventDefault();

        // Check if country exists in the backend
        const countryExists = await checkCountryExists(newAward.country_name);
        if (!countryExists) {
            alert("Country does not exist. Please add the country first.");
            return;
        }

        if (newAward.awards_name && newAward.country_name && newAward.awards_years) {
            const newAwardData = {
                awards_name: newAward.awards_name,
                country_name: newAward.country_name,
                awards_years: newAward.awards_years,
            };

            try {
                const response = await fetch('http://localhost:8001/awards', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(newAwardData),
                });

                const data = await response.json();
                setAwards((prevAwards) => [...prevAwards, data]);
            } catch (error) {
                console.error("Error adding award:", error);
            }
            setNewAward({ country_name: '', awards_years: '', awards_name: '' });
            handleCloseModal();
        } else {
            alert("All fields must be filled!");
        }
    };

    const handleEditAward = async (e) => {
        e.preventDefault();

        if (editAward.awards_name && editAward.country_name && editAward.awards_years) {
            const updatedAwardData = {
                awards_name: editAward.awards_name,
                country_name: editAward.country_name,
                awards_years: editAward.awards_years,
            };

            // Check if the edited country exists in the backend
            const countryExists = await checkCountryExists(editAward.country_name);
            console.log(countryExists);
            if (!countryExists) {
                alert("Country does not exist. Please add the country first.");
                return;
            }

            try {
                const response = await fetch(`http://localhost:8001/awards/${editing}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updatedAwardData),
                });

                const data = await response.json();
                setAwards((prevAwards) =>
                    prevAwards.map((award) => (award.id === editing ? data : award))
                );
                setIsEditing(false);
                setEditing(null);
                handleCloseModal();
            } catch (error) {
                console.error("Error updating award:", error);
            }
        } else {
            alert("All fields must be filled!");
        }
    };


    const handleDeleteAward = async (id) => {
        try {
            await fetch(`http://localhost:8001/awards/${id}`, {
                method: 'DELETE',
            });
            setAwards((prevAwards) => prevAwards.filter((award) => award.id !== id));
        } catch (error) {
            console.error("Error deleting award:", error);
        }
    };

    // Function untuk filter award berdasarkan search term (sebelum pagination)
    const filteredAwards = awards.filter((award) =>
        (award.awards_name && award.awards_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (award.country_name && award.country_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (award.awards_years && award.awards_years.toString().includes(searchTerm))
    );

    const indexOfLastAward = currentPage * showCount;
    const indexOfFirstAward = indexOfLastAward - showCount;
    const currentAwards = filteredAwards.slice(indexOfFirstAward, indexOfLastAward); // Paginate hasil pencarian
    const totalPages = Math.ceil(filteredAwards.length / showCount);

    const handlePageChange = (pageNumber) => {
        setCurrentPage(pageNumber);
    };

    // Logic to show only 3 pages (current, previous, next)
    const renderPagination = () => {
        let items = [];
        const startPage = Math.max(1, currentPage - 1);
        const endPage = Math.min(totalPages, currentPage + 1);

        for (let number = startPage; number <= endPage; number++) {
            items.push(
                <Pagination.Item key={number} active={number === currentPage} onClick={() => handlePageChange(number)}>
                    {number}
                </Pagination.Item>
            );
        }
        return (
            <div className="d-flex justify-content-end">
                <Pagination>
                    <Pagination.First onClick={() => setCurrentPage(1)} />
                    <Pagination.Prev onClick={() => setCurrentPage(currentPage > 1 ? currentPage - 1 : 1)} />
                    {items}
                    <Pagination.Next onClick={() => setCurrentPage(currentPage < totalPages ? currentPage + 1 : totalPages)} />
                    <Pagination.Last onClick={() => setCurrentPage(totalPages)} />
                </Pagination>
            </div>
        );
    };

    return (
        <Container>
            <Container className="App">
                <h1 className="title">Awards Manager</h1>
            </Container>
            {/* Form Section */}
            <Container className="list-drama-header d-flex justify-content-between mb-3">
                <Container className="d-flex">
                    <Col xs="auto" className="d-flex me-3">
                        <Dropdown onSelect={setShowCount}>
                            <Dropdown.Toggle variant="light" id="dropdown-show">
                                Shows: {showCount}
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                                {[10, 20, 50].map((count) => (
                                    <Dropdown.Item key={count} eventKey={count}>
                                        {count}
                                    </Dropdown.Item>
                                ))}
                            </Dropdown.Menu>
                        </Dropdown>
                    </Col>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </Container>

                {/* Button to Add New Award */}
                <Button
                    variant="success"
                    className="d-flex align-items-center w-auto px-4 py-2"
                    style={{ whiteSpace: 'nowrap' }} // Ini mencegah teks tombol pecah ke baris lain
                    onClick={handleShowModal}>
                    <FaPlus className="me-2" />
                    Add New Award
                </Button>
            </Container>

            <Modal show={showModal} onHide={handleCloseModal} centered>
                <Modal.Header closeButton>
                    <Modal.Title>{isEditing ? 'Edit Award' : 'Add New Award'}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form>
                            <Form.Group className="mb-3">
                                <Form.Label>Award</Form.Label>
                                <Form.Control
                                    type="text"
                                    name="awards_name"
                                    value={isEditing ? editAward.awards_name : newAward.awards_name}
                                    onChange={handleInputChange}
                                    placeholder="Enter award"
                                />
                            </Form.Group>
                            <Form.Group className="mb-3">
                                <Form.Label>Country</Form.Label>
                                <Form.Control
                                    type="text"
                                    name="country_name"
                                    value={isEditing ? editAward.country_name : newAward.country_name}
                                    onChange={handleInputChange}
                                    placeholder="Enter country"
                                />
                            </Form.Group>
                            <Form.Group className="mb-3">
                                <Form.Label>Year</Form.Label>
                                <Form.Control
                                    type="number"
                                    name="awards_years"
                                    value={isEditing ? editAward.awards_years : newAward.awards_years}
                                    onChange={handleInputChange}
                                    placeholder="Enter year"
                                />
                            </Form.Group>
                        </Form>

                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button
                        variant="secondary"
                        className="mt-2"
                        onClick={handleCloseModal}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        className="mt-2"
                        style={{ backgroundColor: '#ff5722', borderColor: '#ff5722' }}
                        onClick={isEditing ? handleEditAward : handleAddAward}>
                        {isEditing ? 'Save Changes' : 'Submit'}
                    </Button>
                </Modal.Footer>
            </Modal>

            {loading ? (
                <p>Loading data...</p>
            ) : (
                <>
                    {/* Table Section */}
                    <Container className='award-table-wrapper'>
                        <Table className="award-table" striped bordered hover>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Country</th>
                                    <th>Year</th>
                                    <th>Award</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentAwards.map((award) => (
                                    <tr key={award.id}>
                                        <td>{award.id}</td>
                                        <td>{award.country_name}</td>
                                        <td>{award.awards_years}</td>
                                        <td>{award.awards_name}</td>
                                        <td>
                                            <Container className="action-button">
                                                <Button
                                                    className="btn btn-sm btn-primary me-2"
                                                    onClick={() => {
                                                        setIsEditing(true);
                                                        setShowModal(true);
                                                        setEditAward(award);
                                                        setEditing(award.id);
                                                    }}
                                                >
                                                    Edit
                                                </Button>
                                                <Button
                                                    className="btn btn-sm btn-danger"
                                                    onClick={() => handleDeleteAward(award.id)}
                                                >
                                                    Delete
                                                </Button>
                                            </Container>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    </Container>
                    {renderPagination()}
                </>
            )}
        </Container >
    );
};

export default AwardsManager;
