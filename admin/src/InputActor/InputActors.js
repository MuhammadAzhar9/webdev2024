import React, { useState } from "react";
import { Container, Table, Form, Button, Modal } from 'react-bootstrap';
import { FaPlus } from "react-icons/fa";
import "./InputActor.css";

const ActorManager = () => {
    const [actors, setActors] = useState([
        { id: 1, country: "Japan", name: "Takuya Kimura", birthDate: "19 Desember 1975", photo: "" },
        { id: 2, country: "Japan", name: "Yuko Takeuchi", birthDate: "19 Oktober 1977", photo: "" },
    ]);

    const [newActor, setNewActor] = useState({ country: "", name: "", birthDate: "", photo: "" });
    const [editing, setEditing] = useState(null);
    const [editActor, setEditActor] = useState({ country: "", name: "", birthDate: "", photo: "" });
    const [showModal, setShowModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (isEditing) {
            setEditActor((prev) => ({ ...prev, [name]: value }));
        } else {
            setNewActor((prev) => ({ ...prev, [name]: value }));
        }
    };

    const handleAddActor = (e) => {
        e.preventDefault();
        if (newActor.name.trim() && newActor.country.trim()) {
            setActors((prevActors) => [
                ...prevActors,
                { ...newActor, id: Date.now() }
            ]);
            setNewActor({ country: "", name: "", birthDate: "", photo: "" });
            setShowModal(false);
        } else {
            alert("All fields must be filled!");
        }
    };

    const handleDeleteActor = (id) => {
        setActors((prevActors) => prevActors.filter((actor) => actor.id !== id));
    };

    const handleEditActor = (id) => {
        setEditing(id);
        const actorToEdit = actors.find((actor) => actor.id === id);
        setEditActor(actorToEdit);
        setIsEditing(true);
        setShowModal(true);
    };

    const handleSaveEdit = (e) => {
        e.preventDefault();
        setActors((prevActors) =>
            prevActors.map((actor) => (actor.id === editing ? editActor : actor))
        );
        setEditing(null);
        setEditActor({ country: "", name: "", birthDate: "", photo: "" });
        setShowModal(false);
    };

    const handleShowModal = () => {
        setIsEditing(false);
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
    };

    const handlePhotoChange = (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const photoUrl = URL.createObjectURL(file);

            if (isEditing) {
                setEditActor((prev) => ({
                    ...prev,
                    photo: photoUrl,
                }));
            } else {
                setNewActor((prev) => ({
                    ...prev,
                    photo: photoUrl,
                }));
            }
        } else {
            alert('Please upload a valid image file.');
        }
    };


    return (
        <Container className="input-actor-container">
            {/* Button to Add New Actor */}
            <Button
                variant="success"
                className="d-flex align-items-center ms-auto mb-3"
                onClick={handleShowModal}>
                <FaPlus className="me-2" />
                Add Actor
            </Button>

            {/* Modal for Adding/Editing Actor */}
            <Modal show={showModal} onHide={handleCloseModal} centered>
                <Modal.Header closeButton>
                    <Modal.Title>{isEditing ? "Edit Actor" : "Add New Actor"}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Country</Form.Label>
                            <Form.Control
                                type="text"
                                name="country"
                                value={isEditing ? editActor.country : newActor.country}
                                onChange={handleInputChange}
                                placeholder="Enter country"
                                required
                            />
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Actor Name</Form.Label>
                            <Form.Control
                                type="text"
                                name="name"
                                value={isEditing ? editActor.name : newActor.name}
                                onChange={handleInputChange}
                                placeholder="Enter actor name"
                                required
                            />
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Birth Date</Form.Label>
                            <Form.Control
                                type="text"
                                name="birthDate"
                                value={isEditing ? editActor.birthDate : newActor.birthDate}
                                onChange={handleInputChange}
                                placeholder="Enter birth date"
                            />
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Upload Picture</Form.Label>
                            <Form.Control
                                type="file"
                                name="photo"
                                accept="image/*"
                                onChange={handlePhotoChange}
                            />
                            {/* Preview Image */}
                            {isEditing && editActor.photo && (
                                <div className="mt-2">
                                    <img src={editActor.photo} alt="Preview" width={100} />
                                </div>
                            )}
                            {!isEditing && newActor.photo && (
                                <div className="mt-2">
                                    <img src={newActor.photo} alt="Preview" width={100} />
                                </div>
                            )}
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button
                        variant="secondary"
                        className="mt-2"
                        onClick={() => setShowModal(false)}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        className="mt-2"
                        onClick={isEditing ? handleSaveEdit : handleAddActor}
                        style={{ backgroundColor: '#ff5722', borderColor: '#ff5722' }}
                    >
                        {isEditing ? "Save Changes" : "Add Actor"}
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Table Section */}
            <Table striped bordered hover>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Countries</th>
                        <th>Actor Name</th>
                        <th>Birth Date</th>
                        <th>Photos</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {actors.map((actor, index) => (
                        <tr key={actor.id}>
                            <td>{index + 1}</td>
                            <td>{actor.country}</td>
                            <td>{actor.name}</td>
                            <td>{actor.birthDate}</td>
                            <td>
                                {actor.photo ? (
                                    <img src={actor.photo} alt={actor.name} width={50} />
                                ) : (
                                    <div style={{ width: 50, height: 50, backgroundColor: '#ddd' }} />
                                )}
                            </td>
                            <td>
                                <Button className="btn btn-sm btn-primary me-2" onClick={() => handleEditActor(actor.id)}>
                                    Edit
                                </Button>
                                <Button className="btn btn-sm btn-danger" onClick={() => handleDeleteActor(actor.id)}>
                                    Delete
                                </Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </Container>
    );
};

export default ActorManager;